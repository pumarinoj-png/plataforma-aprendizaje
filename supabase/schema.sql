-- ============================================================
--  Esquema de base de datos - Plataforma de material y tareas
--  VERSIÓN SUPABASE SIN PGCRYPTO (más simple)
-- ============================================================

-- ---------------------------------------------------------------
-- TABLAS
-- ---------------------------------------------------------------

create table if not exists participantes (
  email       text primary key,
  nombre      text not null,
  categorias  text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists materiales (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null,
  descripcion   text default '',
  archivo_path  text,
  categorias    text[] not null default '{}',
  created_at    timestamptz not null default now()
);

create table if not exists tareas (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null,
  descripcion   text default '',
  archivo_path  text,
  categorias    text[] not null default '{}',
  preguntas     jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

create table if not exists respuestas_tareas (
  id            uuid primary key default gen_random_uuid(),
  tarea_id      uuid not null references tareas(id) on delete cascade,
  email         text not null,
  nombre        text not null,
  respuestas    jsonb not null default '{}',
  submitted_at  timestamptz not null default now(),
  unique (tarea_id, email)
);

create table if not exists admin_settings (
  id             int primary key default 1,
  password_plain text not null,
  check (id = 1)
);

-- Clave inicial: cambia-esta-clave
insert into admin_settings (id, password_plain)
values (1, 'cambia-esta-clave')
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- SEGURIDAD: Row Level Security
-- ---------------------------------------------------------------

alter table participantes      enable row level security;
alter table materiales         enable row level security;
alter table tareas             enable row level security;
alter table respuestas_tareas  enable row level security;
alter table admin_settings     enable row level security;

-- ---------------------------------------------------------------
-- FUNCIONES PARA PARTICIPANTES
-- ---------------------------------------------------------------

create or replace function buscar_participante(p_email text)
returns table(nombre text, categorias text[])
language sql security definer set search_path = public as $$
  select nombre, categorias from participantes where lower(email) = lower(p_email);
$$;

create or replace function materiales_para(p_email text)
returns table(id uuid, titulo text, descripcion text, archivo_path text,
              categorias text[], created_at timestamptz)
language sql security definer set search_path = public as $$
  with p as (
    select coalesce((select categorias from participantes where lower(email) = lower(p_email)), '{}'::text[]) as cats
  )
  select m.id, m.titulo, m.descripcion, m.archivo_path, m.categorias, m.created_at
  from materiales m, p
  where m.categorias = '{}' or m.categorias && p.cats
  order by m.created_at desc;
$$;

create or replace function tareas_para(p_email text)
returns table(
  id uuid, titulo text, descripcion text, archivo_path text, categorias text[],
  preguntas jsonb, created_at timestamptz, mis_respuestas jsonb, respondido_en timestamptz
)
language sql security definer set search_path = public as $$
  with p as (
    select coalesce((select categorias from participantes where lower(email) = lower(p_email)), '{}'::text[]) as cats
  )
  select t.id, t.titulo, t.descripcion, t.archivo_path, t.categorias, t.preguntas, t.created_at,
         r.respuestas, r.submitted_at
  from tareas t
  cross join p
  left join respuestas_tareas r on r.tarea_id = t.id and lower(r.email) = lower(p_email)
  where t.categorias = '{}' or t.categorias && p.cats
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
-- FUNCIONES DE ADMINISTRADOR
-- ---------------------------------------------------------------

create or replace function _check_admin(p_password text) returns boolean
language sql security definer set search_path = public as $$
  select exists (
    select 1 from admin_settings where id = 1 and password_plain = p_password
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
  if not _check_admin(p_password_actual) then
    return false;
  end if;
  update admin_settings set password_plain = p_password_nueva where id = 1;
  return true;
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

create or replace function admin_guardar_participante(p_password text, p_email text, p_nombre text, p_categorias text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  insert into participantes (email, nombre, categorias)
  values (lower(p_email), p_nombre, p_categorias)
  on conflict (email) do update set nombre = excluded.nombre, categorias = excluded.categorias;
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

create or replace function admin_agregar_material(p_password text, p_titulo text, p_descripcion text, p_archivo_path text, p_categorias text[])
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  insert into materiales (titulo, descripcion, archivo_path, categorias)
  values (p_titulo, p_descripcion, p_archivo_path, p_categorias)
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

create or replace function admin_agregar_tarea(p_password text, p_titulo text, p_descripcion text, p_archivo_path text, p_categorias text[], p_preguntas jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  insert into tareas (titulo, descripcion, archivo_path, categorias, preguntas)
  values (p_titulo, p_descripcion, p_archivo_path, p_categorias, p_preguntas)
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

create or replace function admin_listar_categorias(p_password text)
returns text[]
language plpgsql security definer set search_path = public as $$
declare v_cats text[];
begin
  if not _check_admin(p_password) then raise exception 'clave incorrecta'; end if;
  select array_agg(distinct c) into v_cats
  from (
    select unnest(categorias) c from participantes
    union
    select unnest(categorias) c from materiales
    union
    select unnest(categorias) c from tareas
  ) s;
  return coalesce(v_cats, '{}');
end;
$$;

grant usage on schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
