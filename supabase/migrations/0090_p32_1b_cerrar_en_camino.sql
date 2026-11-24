-- 0090 · P32.1b · Cerrar el aviso «En camino» de «Requiere atención» (D-09, OG-02)
--
-- El aviso «En camino» (categoría onTheWay del Resumen) tiene que poder cerrarse con ✕ como los
-- demás. Hasta ahora attention_dismissals_kind_check y dismiss_attention (0085) no admitían ese tipo.
-- Se amplía el CHECK y se redefine dismiss_attention con la lista nueva. onTheWay es un aviso de
-- asignación (igual que late y delayNotified): exige assignment_id; la regla de
-- attention_dismissals_assignment_check ya lo cubre (solo uncovered va sin asignación).
-- No hay otra función ni vista que liste los tipos.

alter table public.attention_dismissals
  drop constraint if exists attention_dismissals_kind_check;

alter table public.attention_dismissals
  add constraint attention_dismissals_kind_check check (
    kind in ('absence', 'uncovered', 'noRecord', 'noCheckout', 'overdue', 'outsideGeo', 'late', 'delayNotified', 'onTheWay')
  );

comment on column public.attention_dismissals.kind is 'Tipo de aviso, igual a AttentionKind de src/features/dashboard/attention.ts: absence, uncovered, noRecord, noCheckout, overdue, outsideGeo, late, delayNotified, onTheWay (este último desde 0090).';

create or replace function public.dismiss_attention(
  p_kind text,
  p_shift_id uuid,
  p_assignment_id uuid default null
)
returns public.attention_dismissals
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.attention_dismissals;
begin
  perform app.require_role('owner', 'admin');

  if p_kind is null or p_kind not in
    ('absence', 'uncovered', 'noRecord', 'noCheckout', 'overdue', 'outsideGeo', 'late', 'delayNotified', 'onTheWay') then
    raise exception using
      errcode = 'P0001',
      message = 'Ese tipo de aviso no existe.',
      hint = 'INVALID_ATTENTION_KIND';
  end if;

  if not exists (select 1 from public.shifts s where s.id = p_shift_id and s.deleted_at is null) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if p_kind = 'uncovered' then
    if p_assignment_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'Los avisos de turno sin cubrir se cierran por turno, sin asignación.',
        hint = 'INVALID_ATTENTION_TARGET';
    end if;
  else
    if p_assignment_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'Este aviso es de una asignación: indicá cuál.',
        hint = 'INVALID_ATTENTION_TARGET';
    end if;
    if not exists (
      select 1 from public.assignments a where a.id = p_assignment_id and a.shift_id = p_shift_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'No encontramos esa asignación en el turno.',
        hint = 'ASSIGNMENT_NOT_FOUND';
    end if;
  end if;

  -- Limpieza oportunista (ver app.purge_attention_dismissals).
  perform app.purge_attention_dismissals();

  -- Idempotente: si la situación ya estaba cerrada, devuelve el cierre existente (conserva quién y cuándo).
  insert into public.attention_dismissals (kind, shift_id, assignment_id, dismissed_by)
  values (p_kind, p_shift_id, p_assignment_id, auth.uid())
  on conflict on constraint attention_dismissals_situation_key do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.attention_dismissals d
    where d.kind = p_kind
      and d.shift_id = p_shift_id
      and d.assignment_id is not distinct from p_assignment_id;
  end if;

  return v_row;
end;
$$;

comment on function public.dismiss_attention(text, uuid, uuid) is
  'Cierra un aviso de «Requiere atención» para toda la dirección y la administración (0085, OG-02, C-01; 0090 suma onTheWay). Solo owner y admin (cualquier admin, sin capacidad especial). p_kind: absence, uncovered, noRecord, noCheckout, overdue, outsideGeo, late, delayNotified u onTheWay. uncovered va sin p_assignment_id; los demás lo exigen y tiene que ser del turno. Idempotente: si ya estaba cerrado devuelve el cierre existente. No toca el turno ni la asistencia. Errores: FORBIDDEN, INVALID_ATTENTION_KIND, SHIFT_NOT_FOUND, INVALID_ATTENTION_TARGET, ASSIGNMENT_NOT_FOUND.';

revoke all on function public.dismiss_attention(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.dismiss_attention(text, uuid, uuid) to authenticated;
