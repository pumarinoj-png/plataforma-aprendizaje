-- ============================================================
--  Esquema v2 FINAL - SIN PGCRYPTO (compatible con todas regiones)
--  Dropea TODO antes de crear
-- ============================================================

-- PASO 1: Eliminar FUNCIONES viejas
drop function if exists buscar_participante(text) cascade;
drop function if exists materiales_para(text) cascade;
drop function if exists tareas_para(text) cascade;
drop function if exists enviar_respuesta_tarea(uuid, text, text, jsonb) cascade;
drop function if exists _check_admin(text) cascade;
drop function if exists admin_verificar(text) cascade;
drop function if exists admin_cambiar_password(text, text) cascade;
drop function if exists admin_listar_participantes(text) cascade;
drop function if exists admin_guardar_participante(text, text, text, text[]) cascade;
drop function if exists admin_eliminar_participante(text, text) cascade;
drop function if exists admin_listar_materiales(text) cascade;
drop function if exists admin_agregar_material(text, text, text, text, text, text[]) cascade;
drop function if exists admin_eliminar_material(text, uuid) cascade;
drop function if exists admin_listar_tareas(text) cascade;
drop function if exists admin_agregar_tarea(text, text, text, text, text[], jsonb) cascade;
drop function if exists admin_eliminar_tarea(text, uuid) cascade;
drop function if exists admin_listar_respuestas(text, uuid) cascade;
drop function if exists admin_obtener_curso(text) cascade;
drop function if exists admin_guardar_curso(text, text, text) cascade;
drop function if exists admin_listar_sesiones(text) cascade;
drop function if exists admin_guardar_sesion(text, uuid, text, int) cascade;
drop function if exists admin_eliminar_sesion(text, uuid) cascade;

-- PASO 2: Eliminar TABLAS viejas
drop table if exists respuestas_tareas cascade;
drop table if exists tareas cascade;
drop table if exists materiales cascade;
drop table if exists participantes cascade;
drop table if exists sesiones cascade;
drop table if exists cursos cascade;
drop table if exists admin_settings cascade;

-- ---------------------------------------------------------------
-- TABLAS NUEVAS
-- ---------------------------------------------------------------

create table cursos (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  descripcion   text default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table sesiones (
  id            uuid primary key default gen_random_uuid(),
  curso_id      uuid not null references cursos(id) on delete cascade,
  nombre        text not null,
  orden         int not null default 0,
  created_at    timestamptz not null default now()
);

create table participantes (
  email       text primary key,
  nombre      text not null,
  cargo       text default '',
  sesiones    uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table materiales (
  id            uuid primary key default gen_random_uuid(),
  sesion_id     uuid references sesiones(id) on delete cascade,
  titulo        text not null,
  descripcion   text default '',
  archivo_path  text,
  link_externo  text,
  cargos        text[] not null default '{}',
  created_at    timestamptz not null default now()
);

create table tareas (
  id            uuid primary key default gen_random_uuid(),
  sesion_id     uuid references sesiones(id) on delete cascade,
  titulo        text not null,
  descripcion   text default '',
  archivo_path  text,
  cargos        text[] not null default '{}',
  preguntas     jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

create table respuestas_tareas (
  id            uuid primary key default gen_random_uuid(),
  tarea_id      uuid not null references tareas(id) on delete cascade,
  email         text not null,
  nombre        text not null,
  respuestas    jsonb not null default '{}',
  submitted_at  timestamptz not null default now(),
  unique (tarea_id, email)
);

-- Contraseña en TEXTO PLANO (para desarrollo)
-- En producción, implementa hashing en la aplicación
create table admin_settings (
  id             int primary key default 1,
  password       text not null,
  check (id = 1)
);

insert into admin_settings (id, password)
values (1, 'cambia-esta-clave')
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- SEGURIDAD
-- ---------------------------------------------------------------

alter table cursos             enable row level security;
alter table sesiones           enable row level security;
alter table participantes      enable row level security;
alter table materiales         enable row level security;
alter table tareas             enable row level security;
alter table respuestas_tareas  enable row level security;
alter table admin_settings     enable row level security;

-- ---------------------------------------------------------------
-- FUNCIONES PARTICIPANTES
-- ---------------------------------------------------------------

create or replace function buscar_participante(p_email text)
returns table(nombre text, cargo text, sesiones uuid[])
language sql security definer set search_path = public as $$
  select nombre, cargo, sesiones from participantes where lower(email) = lower(p_email);
$$;

create or replace function materiales_para(p_email text)
returns table(
  id uuid, sesion_id uuid, sesion_nombre text, titulo text, descripcion text,
  archivo_path text, link_externo text, created_at timestamptz
)
language sql security definer set search_path = public as $$
  with p as (
    select coalesce(sesiones, '{}'::uuid[]) as sids, coalesce(cargo, '') as c
    from participantes where lower(email) = lower(p_email)
  )
  select m.id, m.sesion_id, s.nombre, m.titulo, m.descripcion, m.archivo_path, m.link_externo, m.created_at
  from materiales m
  left join sesiones s on s.id = m.sesion_id
  cross join p
  where m.sesion_id is null
     or (m.sesion_id = any(p.sids) and (m.cargos = '{}' or p.c = any(m.cargos)))
  order by m.created_at desc;
$$;

create or replace function tareas_para(p_email text)
returns table(
  id uuid, sesion_id uuid, sesion_nombre text, titulo text, descripcion text,
  archivo_path text, cargos text[], preguntas jsonb, created_at timestamptz,
  mis_respuestas jsonb, respondido_en timestamptz
)
language sql security definer set search_path = public as $$
  with p as (
    select coalesce(sesiones, '{}'::uuid[]) as sids, coalesce(cargo, '') as c
    from participantes where lower(email) = lower(p_email)
  )
  select t.id, t.sesion_id, s.nombre, t.titulo, t.descripcion, t.archivo_path, t.cargos, t.preguntas, t.created_at,
         r.respuestas, r.submitted_at
  from tareas t
  left join sesiones s on s.id = t.sesion_id
  cross join p
  left join respuestas_tareas r on r.tarea_id = t.id and lower(r.email) = lower(p_email)
  where t.sesion_id is null
     or (t.sesion_id = any(p.sids) and (t.cargos = '{}' or p.c = any(t.cargos)))
  order by t.created_at desc;
$$;

create or replace function enviar_respuesta_tarea(p_tarea_id uuid, p_email text, p_nombre text, p_respuestas jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into respuestas_tareas (tarea_id, email, nombre, respuestas)
  values (p_tarea_id, lower(p_email), p_nombre, p_respuestas)
  on conflict (tarea_id, email)
  do update set respuestas = excluded.respuestas, nombre = excluded.nombre, submitted_at = now();
end;
$$;

-- ---------------------------------------------------------------
-- FUNCIONES ADMIN
-- ---------------------------------------------------------------

create or replace function _check_admin(p_password text) returns boolean
language sql security definer set search_path = public as $$
  select exists (
    select 1 from admin_settings where id = 1 and password = p_password
  );
$$;

create or replace function admin_verificar(p_password text) returns boolean
language sql security definer set search_path = public as $$
  select _check_admin(p_password);
$$;

create or replace function admin_cambiar_password(p_password_actual text, p_password_nueva text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password_actual) then return false; end if;
  update admin_settings set password = p_password_nueva where id = 1;
  return true;
end;
$$;

create or replace function admin_obtener_curso(p_password text)
returns table(id uuid, nombre text, descripcion text)
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  return query select c.id, c.nombre, c.descripcion from cursos c limit 1;
end;
$$;

create or replace function admin_guardar_curso(p_password text, p_nombre text, p_descripcion text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  if (select count(*) from cursos) = 0 then
    insert into cursos (nombre, descripcion) values (p_nombre, p_descripcion) returning id into v_id;
  else
    update cursos set nombre = p_nombre, descripcion = p_descripcion returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function admin_listar_sesiones(p_password text)
returns setof sesiones
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  return query select * from sesiones order by orden;
end;
$$;

create or replace function admin_guardar_sesion(p_password text, p_id uuid, p_nombre text, p_orden int)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  if p_id is null then
    insert into sesiones (curso_id, nombre, orden)
    select id, p_nombre, p_orden from cursos limit 1
    returning sesiones.id into v_id;
  else
    update sesiones set nombre = p_nombre, orden = p_orden where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function admin_eliminar_sesion(p_password text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  delete from sesiones where id = p_id;
end;
$$;

create or replace function admin_listar_participantes(p_password text)
returns setof participantes
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  return query select * from participantes order by nombre;
end;
$$;

create or replace function admin_guardar_participante(p_password text, p_email text, p_nombre text, p_cargo text, p_sesiones uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  insert into participantes (email, nombre, cargo, sesiones)
  values (lower(p_email), p_nombre, p_cargo, coalesce(p_sesiones, '{}'))
  on conflict (email) do update set nombre = excluded.nombre, cargo = excluded.cargo, sesiones = excluded.sesiones;
end;
$$;

create or replace function admin_eliminar_participante(p_password text, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  delete from participantes where lower(email) = lower(p_email);
end;
$$;

create or replace function admin_listar_materiales(p_password text)
returns setof materiales
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  return query select * from materiales order by created_at desc;
end;
$$;

create or replace function admin_agregar_material(p_password text, p_sesion_id uuid, p_titulo text, p_descripcion text, p_archivo_path text, p_link_externo text, p_cargos text[])
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  insert into materiales (sesion_id, titulo, descripcion, archivo_path, link_externo, cargos)
  values (p_sesion_id, p_titulo, p_descripcion, p_archivo_path, p_link_externo, coalesce(p_cargos, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function admin_eliminar_material(p_password text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  delete from materiales where id = p_id;
end;
$$;

create or replace function admin_listar_tareas(p_password text)
returns setof tareas
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  return query select * from tareas order by created_at desc;
end;
$$;

create or replace function admin_agregar_tarea(p_password text, p_sesion_id uuid, p_titulo text, p_descripcion text, p_archivo_path text, p_cargos text[], p_preguntas jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  insert into tareas (sesion_id, titulo, descripcion, archivo_path, cargos, preguntas)
  values (p_sesion_id, p_titulo, p_descripcion, p_archivo_path, coalesce(p_cargos, '{}'), p_preguntas)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function admin_eliminar_tarea(p_password text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  delete from tareas where id = p_id;
end;
$$;

create or replace function admin_listar_respuestas(p_password text, p_tarea_id uuid default null)
returns table(id uuid, tarea_id uuid, tarea_titulo text, email text, nombre text,
              respuestas jsonb, submitted_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  return query
    select r.id, r.tarea_id, t.titulo, r.email, r.nombre, r.respuestas, r.submitted_at
    from respuestas_tareas r
    join tareas t on t.id = r.tarea_id
    where p_tarea_id is null or r.tarea_id = p_tarea_id
    order by r.submitted_at desc;
end;
$$;

-- ---------------------------------------------------------------
-- PERMISOS
-- ---------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- ---------------------------------------------------------------
-- STORAGE
-- ---------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('materiales', 'materiales', true)
on conflict (id) do nothing;

drop policy if exists "lectura publica materiales" on storage.objects;
create policy "lectura publica materiales" on storage.objects
  for select using (bucket_id = 'materiales');

drop policy if exists "subida publica materiales" on storage.objects;
create policy "subida publica materiales" on storage.objects
  for insert with check (bucket_id = 'materiales');
