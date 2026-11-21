import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { ChevronRight, Copy, Download, Plus, Upload } from 'lucide-react';
import type { AreaDTO, ReliefItemDTO, Role } from '@relief/shared';
import { api, downloadFile } from '../api/client';
import { useSession } from '../auth/session';
import { formatNumber, formatTime } from '../i18n';
import { useOperation } from '../layouts';
import { ChangePasswordPage } from './public';
import {
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHead,
  Segmented,
  SelectField,
  StatusTag,
  TextField,
  issuesOf,
  useApiData,
  useConfirm,
  useErrorText,
  useIssueText,
  useToast,
} from '../ui/kit';

/** Runs an action, shows success or the translated error, then reloads. */
function useAction(reload?: () => void) {
  const toast = useToast();
  const errorText = useErrorText();
  return async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast(success);
      reload?.();
      return true;
    } catch (err) {
      toast(errorText(err), 'error');
      return false;
    }
  };
}

// ---------- UC05 Manage Members and Devices (FR03) / SA user accounts ----------
interface Member {
  id: string;
  fullName: string;
  mobile: string;
  role: Role;
  status: string;
  lockedUntil: string | null;
  organisationName: string | null;
  createdAt: string;
  devices: { id: string; label: string; status: string; lastSyncAt: string | null }[];
}

export function MembersPage({ admin = false }: { admin?: boolean }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') === 'pending' ? 'pending' : '';
  const data = useApiData((signal) => api.get<{ members: Member[] }>(`/api/members${status ? `?status=${status}` : ''}`, signal), [status]);
  const run = useAction(data.reload);
  const confirm = useConfirm();
  const [approveRole, setApproveRole] = useState<Record<string, string>>({});
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);

  const approve = (m: Member) =>
    run(() => api.post(`/api/members/${m.id}/approve`, m.role === 'OPERATION_ADMINISTRATOR' ? {} : { role: approveRole[m.id] ?? 'FIELD_VOLUNTEER' }), t('members.updated'));
  const reject = async (m: Member) => {
    const reason = await confirm.ask(`${t('common.reject')}: ${m.fullName}. ${t('members.rejectReason')}`, true, { confirmLabel: t('common.reject') });
    if (reason) await run(() => api.post(`/api/members/${m.id}/reject`, { reason }), t('members.updated'));
  };
  const deactivate = async (m: Member) => {
    if (await confirm.ask(t('members.deactivateConfirm', { name: m.fullName }), false, { confirmLabel: t('members.deactivate') }))
      await run(() => api.post(`/api/members/${m.id}/deactivate`), t('members.updated'));
  };
  const issueTemp = async (m: Member) => {
    try {
      const r = await api.post<{ temporaryPassword: string }>(`/api/members/${m.id}/temporary-password`);
      setTemp({ name: m.fullName, password: r.temporaryPassword });
      data.reload();
    } catch {
      await run(() => Promise.reject(new Error('unexpected')), '');
    }
  };
  const revoke = async (deviceId: string, label: string) => {
    if (await confirm.ask(t('members.revokeConfirm', { device: label }), false, { confirmLabel: t('members.revoke') }))
      await run(() => api.post(`/api/devices/${deviceId}/revoke`), t('members.updated'));
  };
  const changeRole = (m: Member, role: string) => run(() => api.post(`/api/members/${m.id}/role`, { role }), t('members.updated'));

  return (
    <>
      <PageHead title={admin ? t('admin.usersTitle') : t('members.title')} lead={admin ? t('admin.usersIntro') : t('members.intro')} />
      <Segmented<'pending' | ''>
        label={t('common.status')}
        value={status}
        onChange={(s) => setParams(s ? { status: s } : {})}
        options={[
          { value: '', label: t('members.all') },
          { value: 'pending', label: t('members.pending') },
        ]}
      />
      {temp && (
        <Notice tone="warn">
          <p>{t('members.tempPasswordShown', { name: temp.name, password: '' })}</p>
          <p className="short-code" style={{ fontSize: '1.6rem' }}>
            {temp.password}
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTemp(null)}>
            {t('common.close')}
          </button>
        </Notice>
      )}
      {data.loading && !data.data && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.members.length === 0 && <Empty title={status === 'pending' ? t('members.nonePending') : t('common.noResults')} mark="synced" />}
      {data.data && data.data.members.length > 0 && (
        <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={admin ? t('admin.usersTitle') : t('members.title')}>
          <table>
            <caption className="visually-hidden">{admin ? t('admin.usersTitle') : t('members.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('common.mobile')}</th>
                {admin && <th scope="col">{t('common.organisation')}</th>}
                <th scope="col">{t('common.role')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('members.devices')}</th>
                <th scope="col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.members.map((m) => {
                const orgMember = m.role === 'FIELD_VOLUNTEER' || m.role === 'GROUP_COORDINATOR';
                const self = m.id === user?.id;
                return (
                  <tr key={m.id}>
                    <td className="stack-head">{m.fullName}</td>
                    <td data-label={t('common.mobile')} className="tabular">
                      {m.mobile}
                    </td>
                    {admin && <td data-label={t('common.organisation')}>{m.organisationName ?? '—'}</td>}
                    <td data-label={t('common.role')}>
                      {orgMember && (m.status === 'active' || m.status === 'locked') && !self ? (
                        <select aria-label={`${t('members.assignRole')}: ${m.fullName}`} value={m.role} onChange={(e) => void changeRole(m, e.target.value)} style={{ minHeight: 36 }}>
                          <option value="FIELD_VOLUNTEER">{t('roles.FIELD_VOLUNTEER')}</option>
                          <option value="GROUP_COORDINATOR">{t('roles.GROUP_COORDINATOR')}</option>
                        </select>
                      ) : (
                        t(`roles.${m.role}`)
                      )}
                    </td>
                    <td data-label={t('common.status')}>
                      <span>
                        <StatusTag status={m.status} />
                        {m.lockedUntil && m.status === 'locked' && <span className="cell-sub">{t('members.lockedUntil', { time: formatTime(m.lockedUntil) })}</span>}
                      </span>
                    </td>
                    <td data-label={t('members.devices')}>
                      {m.devices.length === 0 ? (
                        <span className="muted small">{t('members.noDevices')}</span>
                      ) : (
                        <span>
                          {m.devices.map((d) => (
                            <span key={d.id} className="device-line">
                              <span>{d.label}</span>
                              <StatusTag status={d.status} />
                              {d.lastSyncAt && <span className="muted">{t('members.lastSync', { time: formatTime(d.lastSyncAt) })}</span>}
                              {d.status === 'active' && (
                                <button type="button" className="link-button danger small" style={{ minHeight: 32 }} onClick={() => void revoke(d.id, d.label)}>
                                  {t('members.revoke')}
                                </button>
                              )}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td data-label={t('common.actions')}>
                      <div className="table-actions">
                        {m.status === 'pending' && (
                          <>
                            {orgMember && (
                              <select
                                aria-label={`${t('members.approveAs')}: ${m.fullName}`}
                                value={approveRole[m.id] ?? 'FIELD_VOLUNTEER'}
                                onChange={(e) => setApproveRole({ ...approveRole, [m.id]: e.target.value })}
                              >
                                <option value="FIELD_VOLUNTEER">{t('roles.FIELD_VOLUNTEER')}</option>
                                <option value="GROUP_COORDINATOR">{t('roles.GROUP_COORDINATOR')}</option>
                              </select>
                            )}
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => void approve(m)}>
                              {t('common.approve')}
                            </button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reject(m)}>
                              {t('common.reject')}
                            </button>
                          </>
                        )}
                        {(m.status === 'active' || m.status === 'locked') && !self && (
                          <>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void issueTemp(m)}>
                              {t('members.tempPassword')}
                            </button>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => void deactivate(m)}>
                              {t('members.deactivate')}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirm.dialog}
    </>
  );
}

// ---------- UC06 Manage Operation Lifecycle ----------
export function OperationsPage() {
  const { t, i18n } = useTranslation();
  const { operations, reload, select } = useOperation();
  const types = useApiData((signal) => api.get<{ disasterTypes: { id: string; nameEn: string; nameBn: string; active: boolean }[] }>('/api/disaster-types', signal), []);
  const issueText = useIssueText();
  const errorText = useErrorText();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', disasterTypeId: '', startDate: new Date().toISOString().slice(0, 10) });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const mine = operations.filter((o) => o.relation === 'admin');
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setIssues({});
    try {
      const r = await api.post<{ id: string }>('/api/operations', form);
      toast(t('operations.createdNew'));
      setForm({ ...form, name: '' });
      select(r.id);
      reload();
    } catch (err) {
      setIssues(issuesOf(err));
      toast(errorText(err), 'error');
    }
  };
  return (
    <>
      <PageHead title={t('operations.title')} lead={t('operations.intro')} />
      <div className="grid-2">
        <section className="panel" aria-labelledby="ops-mine">
          <h2 id="ops-mine">{t('operations.mine')}</h2>
          {mine.length === 0 ? (
            <p className="muted">{t('operations.none')}</p>
          ) : (
            <ul className="list">
              {mine.map((o) => (
                <li key={o.id}>
                  <Link className="list-row" to={`/app/operations/${o.id}`}>
                    <span className="list-main">
                      <span className="list-title">{o.name}</span>
                      <span className="list-sub">
                        {i18n.language === 'bn' ? o.disasterType.bn : o.disasterType.en} · {o.startDate}
                      </span>
                    </span>
                    <span className="list-end">
                      <StatusTag status={o.status} />
                      <ChevronRight size={18} className="chev" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <form className="panel" onSubmit={create} aria-labelledby="ops-create">
          <h2 id="ops-create">{t('operations.create')}</h2>
          <TextField label={t('operations.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={issueText(issues.name)} autoComplete="off" />
          <SelectField label={t('operations.disasterType')} value={form.disasterTypeId} onChange={(e) => setForm({ ...form, disasterTypeId: e.target.value })} error={issueText(issues.disasterTypeId)}>
            <option value="">{t('common.choose')}</option>
            {types.data?.disasterTypes
              .filter((d) => d.active)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {i18n.language === 'bn' ? d.nameBn : d.nameEn}
                </option>
              ))}
          </SelectField>
          <TextField label={t('operations.startDate')} type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} error={issueText(issues.startDate)} />
          <button type="submit" className="btn btn-primary">
            <Plus size={18} aria-hidden />
            {t('operations.create')}
          </button>
        </form>
      </div>
    </>
  );
}

// ---------- UC07 areas and items, UC09 join requests, team, invites, close ----------
interface JoinRequest {
  organisationId: string;
  name: string;
  orgType: string;
  contactName: string;
  contactPhone: string;
  status: string;
  requestedAt: string;
  rejectionReason: string | null;
}

export function OperationDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { reload: reloadOps } = useOperation();
  const op = useApiData(
    (signal) => api.get<{ operation: { id: string; name: string; status: string; startDate: string; closedAt: string | null; areaCount: number; itemCount: number; memberCount: number } }>(`/api/operations/${id}`, signal),
    [id],
  );
  const areas = useApiData((signal) => api.get<{ areas: AreaDTO[] }>(`/api/operations/${id}/areas`, signal), [id]);
  const items = useApiData((signal) => api.get<{ items: ReliefItemDTO[] }>(`/api/operations/${id}/items`, signal), [id]);
  const joins = useApiData((signal) => api.get<{ requests: JoinRequest[] }>(`/api/operations/${id}/join-requests`, signal), [id]);
  const admins = useApiData((signal) => api.get<{ admins: { userId: string; fullName: string }[] }>(`/api/operations/${id}/admins`, signal), [id]);
  const invites = useApiData(
    (signal) => api.get<{ invites: { id: string; organisationName: string | null; expiresAt: string; usedAt: string | null; usedByName: string | null }[] }>(`/api/operations/${id}/invites`, signal),
    [id],
  );
  const confirm = useConfirm();
  const issueText = useIssueText();
  const errorText = useErrorText();
  const toast = useToast();
  const runAreas = useAction(() => {
    areas.reload();
    op.reload();
  });
  const runItems = useAction(items.reload);
  const runJoins = useAction(joins.reload);
  const [area, setArea] = useState({ upazila: '', unionName: '', ward: '', upazilaBn: '', unionBn: '' });
  const [areaIssues, setAreaIssues] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<{ imported: number; rejected: { line: number; reason: string }[] } | null>(null);
  const [item, setItem] = useState({ itemName: '', itemNameBn: '', unit: '' });
  const [adminMobile, setAdminMobile] = useState('');
  const [inviteOrg, setInviteOrg] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  if (op.loading && !op.data) return <Loading />;
  if (op.error || !op.data) return <ErrorState error={op.error} onRetry={op.reload} />;
  const o = op.data.operation;
  const active = o.status === 'active';

  const addArea = async (e: FormEvent) => {
    e.preventDefault();
    setAreaIssues({});
    try {
      await api.post(`/api/operations/${id}/areas`, area);
      toast(t('operations.setupSaved'));
      setArea({ ...area, ward: '' });
      areas.reload();
    } catch (err) {
      setAreaIssues(issuesOf(err));
      toast(errorText(err), 'error');
    }
  };
  const importCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const r = await api.post<{ imported: number; rejected: { line: number; reason: string }[] }>(`/api/operations/${id}/areas/import`, { csv: await file.text() });
      setImportResult(r);
      areas.reload();
      op.reload();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      e.target.value = '';
    }
  };
  const close = async () => {
    if (await confirm.ask(t('operations.closeConfirm', { name: o.name }), false, { confirmLabel: t('operations.close') })) {
      await runAreas(() => api.post(`/api/operations/${id}/close`, { confirm: true }), t('operations.created'));
      reloadOps();
    }
  };
  const rejectJoin = async (r: JoinRequest) => {
    const reason = await confirm.ask(`${t('common.reject')}: ${r.name}`, true, { confirmLabel: t('common.reject') });
    if (reason) await runJoins(() => api.post(`/api/operations/${id}/memberships/${r.organisationId}/reject`, { reason }), t('members.updated'));
  };
  const removeArea = async (a: AreaDTO) => {
    // UI audit F43: removing an area is destructive, so it asks first.
    if (await confirm.ask(t('operations.removeAreaConfirm', { area: `${a.upazila}, ${a.unionName}, ${a.ward}` }), false, { confirmLabel: t('common.remove') }))
      await runAreas(() => api.del(`/api/operations/${id}/areas/${a.id}`), t('operations.setupSaved'));
  };
  const copyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast(t('operations.copied'));
    } catch {
      toast(t('operations.copyFailed'), 'error');
    }
  };

  return (
    <>
      <PageHead
        title={o.name}
        back={{ to: '/app/operations', label: t('operations.title') }}
        meta={
          <>
            <StatusTag status={o.status} />
            <span>{o.closedAt ? t('operations.closed', { time: formatTime(o.closedAt) }) : t('operations.counts', { areas: o.areaCount, items: o.itemCount, members: o.memberCount })}</span>
          </>
        }
        actions={
          active ? (
            <button type="button" className="btn btn-danger" onClick={() => void close()}>
              {t('operations.close')}
            </button>
          ) : undefined
        }
      />

      <section className="panel" aria-labelledby="joins-title">
        <h2 id="joins-title">{t('operations.joinRequests')}</h2>
        {joins.data && joins.data.requests.length === 0 && <p className="muted">{t('operations.noRequests')}</p>}
        {joins.data && joins.data.requests.length > 0 && (
          <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={t('operations.joinRequests')}>
            <table>
              <caption className="visually-hidden">{t('operations.joinRequests')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('common.organisation')}</th>
                  <th scope="col">{t('admin.contact')}</th>
                  <th scope="col">{t('common.time')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {joins.data.requests.map((r) => (
                  <tr key={r.organisationId}>
                    <td className="stack-head">{r.name}</td>
                    <td data-label={t('admin.contact')}>
                      <span>
                        {r.contactName}
                        <span className="cell-sub tabular">{r.contactPhone}</span>
                      </span>
                    </td>
                    <td data-label={t('common.time')} className="nowrap">
                      {formatTime(r.requestedAt)}
                    </td>
                    <td data-label={t('common.status')}>
                      <span>
                        <StatusTag status={r.status} />
                        {r.rejectionReason && <span className="cell-sub">{r.rejectionReason}</span>}
                      </span>
                    </td>
                    <td data-label={t('common.actions')}>
                      {r.status === 'pending' && active && (
                        <div className="table-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => void runJoins(() => api.post(`/api/operations/${id}/memberships/${r.organisationId}/approve`), t('operations.joinApproved'))}
                          >
                            {t('common.approve')}
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void rejectJoin(r)}>
                            {t('common.reject')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="areas-title">
        <div className="section-title">
          <h2 id="areas-title">{t('operations.areas')}</h2>
          {areas.data && <span className="badge-count badge-quiet">{formatNumber(areas.data.areas.length)}</span>}
        </div>
        {active && (
          <div className="form-section">
            <form onSubmit={addArea} className="form-grid" noValidate>
              <TextField label={t('operations.upazila')} value={area.upazila} onChange={(e) => setArea({ ...area, upazila: e.target.value })} error={issueText(areaIssues.upazila)} autoComplete="off" />
              <TextField label={t('operations.union')} value={area.unionName} onChange={(e) => setArea({ ...area, unionName: e.target.value })} error={issueText(areaIssues.unionName)} autoComplete="off" />
              <TextField label={t('operations.ward')} value={area.ward} onChange={(e) => setArea({ ...area, ward: e.target.value })} error={issueText(areaIssues.ward)} autoComplete="off" />
              <TextField label={t('operations.upazilaBn')} value={area.upazilaBn} onChange={(e) => setArea({ ...area, upazilaBn: e.target.value })} lang="bn" autoComplete="off" />
              <TextField label={t('operations.unionBn')} value={area.unionBn} onChange={(e) => setArea({ ...area, unionBn: e.target.value })} lang="bn" autoComplete="off" />
              <div className="field-actions">
                <button type="submit" className="btn btn-primary">
                  <Plus size={18} aria-hidden />
                  {t('operations.addArea')}
                </button>
              </div>
            </form>
            <div className="field">
              <label htmlFor="csv-file">
                <Upload size={16} aria-hidden /> {t('operations.importCsv')}
              </label>
              <span className="help">{t('operations.csvHelp')}</span>
              <input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => void importCsv(e)} />
            </div>
          </div>
        )}
        {importResult && (
          <Notice tone={importResult.rejected.length ? 'warn' : 'ok'}>
            <p>{t('operations.imported', { n: importResult.imported })}</p>
            {importResult.rejected.length > 0 && (
              <>
                <strong>{t('operations.rejectedRows')}</strong>
                <ul>
                  {importResult.rejected.map((r) => (
                    <li key={r.line}>
                      {t('operations.line', { n: r.line })}: {r.reason === 'duplicate' ? t('errors.area_exists') : r.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Notice>
        )}
        {areas.data && areas.data.areas.length > 0 && (
          <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={t('operations.areas')}>
            <table>
              <caption className="visually-hidden">{t('operations.areas')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('operations.upazila')}</th>
                  <th scope="col">{t('operations.union')}</th>
                  <th scope="col">{t('operations.ward')}</th>
                  {active && <th scope="col">{t('common.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {areas.data.areas.map((a) => (
                  <tr key={a.id}>
                    <td className="stack-head">
                      {a.upazila}
                      {a.upazilaBn && (
                        <span className="cell-sub" lang="bn">
                          {a.upazilaBn}
                        </span>
                      )}
                    </td>
                    <td data-label={t('operations.union')}>
                      <span>
                        {a.unionName}
                        {a.unionBn && (
                          <span className="cell-sub" lang="bn">
                            {a.unionBn}
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-label={t('operations.ward')}>{a.ward}</td>
                    {active && (
                      <td data-label={t('common.actions')}>
                        <button type="button" className="link-button danger" style={{ minHeight: 32 }} onClick={() => void removeArea(a)}>
                          {t('common.remove')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="items-title">
        <div className="section-title">
          <h2 id="items-title">{t('operations.items')}</h2>
          {items.data && <span className="badge-count badge-quiet">{formatNumber(items.data.items.length)}</span>}
        </div>
        {active && (
          <form
            className="form-grid form-section"
            onSubmit={(e) => {
              e.preventDefault();
              void runItems(() => api.post(`/api/operations/${id}/items`, item), t('operations.setupSaved')).then((ok) => ok && setItem({ itemName: '', itemNameBn: '', unit: '' }));
            }}
          >
            <TextField label={t('operations.itemName')} value={item.itemName} onChange={(e) => setItem({ ...item, itemName: e.target.value })} autoComplete="off" />
            <TextField label={t('operations.itemNameBn')} value={item.itemNameBn} onChange={(e) => setItem({ ...item, itemNameBn: e.target.value })} lang="bn" autoComplete="off" />
            <TextField label={t('operations.unit')} value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} autoComplete="off" />
            <div className="field-actions">
              <button type="submit" className="btn btn-primary" disabled={!item.itemName || !item.unit}>
                {t('common.add')}
              </button>
            </div>
          </form>
        )}
        <ul className="list">
          {items.data?.items.map((i) => (
            <li key={i.id} className="list-row">
              <span className="list-main">
                <span className="list-title">
                  {i.itemName} {i.itemNameBn && <span lang="bn">({i.itemNameBn})</span>}
                </span>
                <span className="list-sub">{i.unit}</span>
              </span>
              <span className="list-end">
                {!i.active && <StatusTag status="deactivated" />}
                {active && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void runItems(() => api.patch(`/api/operations/${id}/items/${i.id}`, { active: !i.active }), t('operations.setupSaved'))}>
                    {i.active ? t('operations.retire') : t('operations.reuse')}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="team-title">
          <h2 id="team-title">{t('operations.team')}</h2>
          <ul className="list">
            {admins.data?.admins.map((a) => (
              <li key={a.userId} className="list-row">
                {a.fullName}
              </li>
            ))}
          </ul>
          <form
            className="form-section"
            onSubmit={(e) => {
              e.preventDefault();
              void addAdmin();
            }}
          >
            <TextField label={t('operations.addAdmin')} type="tel" inputMode="tel" autoComplete="off" value={adminMobile} onChange={(e) => setAdminMobile(e.target.value)} />
            <button type="submit" className="btn btn-secondary" disabled={!adminMobile}>
              {t('common.add')}
            </button>
          </form>
        </section>
        <section className="panel" aria-labelledby="invites-title">
          <h2 id="invites-title">{t('operations.invites')}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void api
                .post<{ path: string }>(`/api/operations/${id}/invites`, { organisationName: inviteOrg || undefined })
                .then((r) => {
                  setInviteLink(`${window.location.origin}${r.path}`);
                  setInviteOrg('');
                  invites.reload();
                })
                .catch((err) => toast(errorText(err), 'error'));
            }}
          >
            <TextField label={t('operations.inviteOrg')} value={inviteOrg} onChange={(e) => setInviteOrg(e.target.value)} autoComplete="off" />
            <button type="submit" className="btn btn-secondary">
              {t('operations.createInvite')}
            </button>
          </form>
          {inviteLink && (
            <Notice tone="ok">
              <span>{t('operations.inviteLink')}</span>
              <span className="row" style={{ width: '100%' }}>
                <input className="grow" readOnly value={inviteLink} onFocus={(e) => e.target.select()} aria-label={t('operations.invites')} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyInvite()}>
                  <Copy size={16} aria-hidden />
                  {t('operations.copyLink')}
                </button>
              </span>
            </Notice>
          )}
          <ul className="list mt-4">
            {invites.data?.invites.map((i) => (
              <li key={i.id} className="list-row small">
                <span>{i.organisationName ?? '—'}</span>
                <span className="muted">{i.usedAt ? t('operations.used', { name: i.usedByName ?? '' }) : t('operations.unused', { time: formatTime(i.expiresAt) })}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {confirm.dialog}
    </>
  );

  async function addAdmin() {
    try {
      await api.post(`/api/operations/${id}/admins`, { mobile: adminMobile });
      toast(t('operations.setupSaved'));
      setAdminMobile('');
      admins.reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }
}

// ---------- UC08 Request to Join Operation ----------
export function JoinPage() {
  const { t, i18n } = useTranslation();
  const { operations, reload } = useOperation();
  const run = useAction(reload);
  const active = operations.filter((o) => o.status === 'active');
  return (
    <>
      <PageHead title={t('operations.joinTitle')} lead={t('operations.joinIntro')} />
      {active.length === 0 ? (
        <Empty title={t('operations.none')} mark="no_records" />
      ) : (
        <ul className="list panel">
          {active.map((o) => (
            <li key={o.id} className="list-row">
              <span className="list-main">
                <span className="list-title">{o.name}</span>
                <span className="list-sub">
                  {i18n.language === 'bn' ? o.disasterType.bn : o.disasterType.en} · {o.startDate}
                </span>
              </span>
              {o.membershipStatus && o.membershipStatus !== 'rejected' ? (
                <StatusTag status={o.membershipStatus} />
              ) : (
                <span className="list-end">
                  {o.membershipStatus === 'rejected' && <StatusTag status="rejected" />}
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void run(() => api.post(`/api/operations/${o.id}/join`), t('operations.requested'))}>
                    {t('operations.request')}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- UC24 Search and Export Audit Trail ----------
interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  changedFields: string[] | null;
  userName: string | null;
  organisationName: string | null;
  deviceLabel: string | null;
}

export function AuditPage() {
  const { t } = useTranslation();
  const { role } = useSession();
  const { current } = useOperation();
  const toast = useToast();
  const errorText = useErrorText();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(() => Object.fromEntries(params));
  const [pages, setPages] = useState<AuditEntry[][]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const query = new URLSearchParams(params);
  if (role === 'OPERATION_ADMINISTRATOR' && current) query.set('operationId', current.id);
  const qs = query.toString();
  const first = useApiData(
    async (signal) => {
      const r = await api.get<{ entries: AuditEntry[]; nextBefore: string | null }>(`/api/audit?${qs}`, signal);
      setPages([r.entries]);
      setNext(r.nextBefore);
      return r;
    },
    [qs],
  );
  const more = async () => {
    if (!next) return;
    setMoreBusy(true);
    try {
      const r = await api.get<{ entries: AuditEntry[]; nextBefore: string | null }>(`/api/audit?${qs}&before=${next}`);
      setPages((p) => [...p, r.entries]);
      setNext(r.nextBefore);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setMoreBusy(false);
    }
  };
  const exportCsv = async () => {
    try {
      await downloadFile(`/api/audit/export.csv?${qs}`);
      toast(t('audit.exported'));
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const entries = pages.flat();
  const set = (k: string) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  const filtered = [...params.keys()].length > 0;
  return (
    <>
      <PageHead
        title={t('audit.title')}
        lead={t('audit.intro')}
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void exportCsv()}>
            <Download size={18} aria-hidden />
            {t('audit.export')}
          </button>
        }
      />
      <form
        className="panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)));
        }}
      >
        <div className="form-grid">
          <TextField label={t('audit.action')} value={draft.action ?? ''} onChange={set('action')} placeholder={t('audit.actionPlaceholder')} autoComplete="off" spellCheck={false} />
          <TextField label={t('audit.from')} type="date" value={draft.from ?? ''} onChange={set('from')} />
          <TextField label={t('audit.to')} type="date" value={draft.to ?? ''} onChange={set('to')} />
        </div>
        <details className="more-filters" open={!!(draft.userId || draft.organisationId || draft.deviceId)}>
          <summary>{t('audit.moreFilters')}</summary>
          <div className="form-grid">
            <TextField label={t('audit.userId')} value={draft.userId ?? ''} onChange={set('userId')} autoComplete="off" spellCheck={false} />
            <TextField label={t('audit.organisationId')} value={draft.organisationId ?? ''} onChange={set('organisationId')} autoComplete="off" spellCheck={false} />
            <TextField label={t('audit.deviceId')} value={draft.deviceId ?? ''} onChange={set('deviceId')} autoComplete="off" spellCheck={false} />
          </div>
        </details>
        <div className="row">
          <button type="submit" className="btn btn-primary">
            {t('common.search')}
          </button>
          {filtered && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setDraft({});
                setParams({});
              }}
            >
              {t('common.clear')}
            </button>
          )}
        </div>
      </form>
      {first.loading && entries.length === 0 && <Loading rows={6} />}
      {first.error ? <ErrorState error={first.error} onRetry={first.reload} /> : null}
      {!first.loading && entries.length === 0 && !first.error && <Empty title={t('audit.none')} mark="no_records" />}
      {entries.length > 0 && (
        <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={t('audit.title')}>
          <table>
            <caption className="visually-hidden">{t('audit.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('common.time')}</th>
                <th scope="col">{t('audit.action')}</th>
                <th scope="col">{t('audit.entity')}</th>
                <th scope="col">{t('common.user')}</th>
                <th scope="col">{t('common.organisation')}</th>
                <th scope="col">{t('common.device')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="stack-head nowrap">{formatTime(e.createdAt)}</td>
                  <td data-label={t('audit.action')}>
                    <span>
                      <code translate="no">{e.action}</code>
                      {e.changedFields?.length ? <span className="cell-sub">{e.changedFields.join(', ')}</span> : null}
                    </span>
                  </td>
                  <td data-label={t('audit.entity')} className="small">
                    {e.entityType ?? '—'}
                  </td>
                  <td data-label={t('common.user')}>{e.userName ?? '—'}</td>
                  <td data-label={t('common.organisation')}>{e.organisationName ?? '—'}</td>
                  <td data-label={t('common.device')}>{e.deviceLabel ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <button type="button" className="btn btn-secondary" disabled={moreBusy} onClick={() => void more()}>
          {moreBusy ? t('app.loading') : t('common.more')}
        </button>
      )}
    </>
  );
}

// ---------- UC04 Approve Organisation ----------
interface Org {
  id: string;
  name: string;
  nameBn: string | null;
  orgType: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  coordinators: { fullName: string; mobile: string; status: string }[];
}

type OrgFilter = 'pending' | 'approved' | 'rejected' | 'all';

export function AdminOrganisationsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'pending') as OrgFilter;
  const data = useApiData((signal) => api.get<{ organisations: Org[] }>(`/api/admin/organisations${status === 'all' ? '' : `?status=${status}`}`, signal), [status]);
  const run = useAction(data.reload);
  const confirm = useConfirm();
  const reject = async (o: Org) => {
    const reason = await confirm.ask(`${t('common.reject')}: ${o.name}`, true, { confirmLabel: t('common.reject') });
    if (reason) await run(() => api.post(`/api/admin/organisations/${o.id}/reject`, { reason }), t('members.updated'));
  };
  return (
    <>
      <PageHead title={t('admin.orgsTitle')} lead={t('admin.orgsIntro')} />
      <Segmented<OrgFilter>
        label={t('common.status')}
        value={status}
        onChange={(s) => setParams({ status: s })}
        options={(['pending', 'approved', 'rejected', 'all'] as const).map((s) => ({ value: s, label: s === 'all' ? t('members.all') : t(`statuses.${s}`) }))}
      />
      {data.loading && !data.data && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.organisations.length === 0 && <Empty title={status === 'pending' ? t('admin.nonePending') : t('common.noResults')} mark="synced" />}
      {data.data?.organisations.map((o) => (
        <section key={o.id} className="panel" aria-labelledby={`org-${o.id}`}>
          <div className="section-title">
            <h2 id={`org-${o.id}`}>
              {o.name} {o.nameBn && <span lang="bn">({o.nameBn})</span>}
            </h2>
            <StatusTag status={o.status} />
          </div>
          <dl className="dl">
            <dt>{t('auth.orgType')}</dt>
            <dd>{t(`auth.orgTypes.${o.orgType}`, { defaultValue: o.orgType })}</dd>
            <dt>{t('admin.contact')}</dt>
            <dd>
              {o.contactName}, <span className="tabular">{o.contactPhone}</span>
              {o.contactEmail ? `, ${o.contactEmail}` : ''}
            </dd>
            <dt>{t('admin.coordinator')}</dt>
            <dd>{o.coordinators.map((c) => `${c.fullName} (${c.mobile})`).join(', ') || '—'}</dd>
            <dt>{t('common.time')}</dt>
            <dd>{formatTime(o.createdAt)}</dd>
            {o.rejectionReason && (
              <>
                <dt>{t('common.reason')}</dt>
                <dd>{o.rejectionReason}</dd>
              </>
            )}
          </dl>
          {o.status === 'pending' && (
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => void run(() => api.post(`/api/admin/organisations/${o.id}/approve`), t('admin.approved'))}>
                {t('common.approve')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void reject(o)}>
                {t('common.reject')}
              </button>
            </div>
          )}
        </section>
      ))}
      {confirm.dialog}
    </>
  );
}

// ---------- NFR21 disaster types ----------
export function DisasterTypesPage() {
  const { t } = useTranslation();
  const data = useApiData((signal) => api.get<{ disasterTypes: { id: string; nameEn: string; nameBn: string; active: boolean }[] }>('/api/disaster-types', signal), []);
  const run = useAction(data.reload);
  const [form, setForm] = useState({ nameEn: '', nameBn: '' });
  return (
    <>
      <PageHead title={t('admin.typesTitle')} lead={t('admin.typesIntro')} />
      <form
        className="panel form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api.post('/api/admin/disaster-types', { ...form, active: true }), t('operations.setupSaved')).then((ok) => ok && setForm({ nameEn: '', nameBn: '' }));
        }}
      >
        <TextField label={t('admin.nameEn')} value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} autoComplete="off" />
        <TextField label={t('admin.nameBn')} value={form.nameBn} onChange={(e) => setForm({ ...form, nameBn: e.target.value })} lang="bn" autoComplete="off" />
        <div className="field-actions">
          <button type="submit" className="btn btn-primary" disabled={!form.nameEn || !form.nameBn}>
            <Plus size={18} aria-hidden />
            {t('common.add')}
          </button>
        </div>
      </form>
      {data.loading && !data.data && <Loading />}
      {data.data && (
        <ul className="list panel">
          {data.data.disasterTypes.map((d) => (
            <li key={d.id} className="list-row">
              <span className="list-main">
                <span className="list-title">{d.nameEn}</span>
                <span className="list-sub" lang="bn">
                  {d.nameBn}
                </span>
              </span>
              <span className="list-end">
                {!d.active && <StatusTag status="deactivated" />}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void run(() => api.patch(`/api/admin/disaster-types/${d.id}`, { active: !d.active }), t('operations.setupSaved'))}>
                  {d.active ? t('operations.retire') : t('operations.reuse')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- NFR13 backup and NFR07 retention ----------
export function SystemPage() {
  const { t } = useTranslation();
  const backups = useApiData(
    (signal) =>
      api.get<{ runs: { id: string; kind: string; status: string; file: string | null; sizeBytes: number | null; startedAt: string; detail: string | null }[]; databaseKind: string; dailyEnabled: boolean }>('/api/admin/backups', signal),
    [],
  );
  const retention = useApiData(
    (signal) => api.get<{ retentionDays: number; operations: { id: string; name: string; closed_at: string; due_at: string; redacted_at: string | null }[] }>('/api/admin/retention', signal),
    [],
  );
  const toast = useToast();
  const errorText = useErrorText();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast(await fn());
      backups.reload();
      retention.reload();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const runRetention = async () => {
    // UI audit F43: redaction cannot be undone, so it asks first.
    if (!(await confirm.ask(t('admin.retentionConfirm'), false, { confirmLabel: t('admin.runRetention') }))) return;
    await act(async () => t('admin.retentionRan', { n: (await api.post<{ redacted: unknown[] }>('/api/admin/retention/run')).redacted.length }));
  };
  return (
    <>
      <PageHead title={t('admin.systemTitle')} />
      <section className="panel" aria-labelledby="backups-title">
        <h2 id="backups-title">{t('admin.backups')}</h2>
        {backups.data?.databaseKind === 'pglite' && <Notice tone="warn">{t('admin.pglite')}</Notice>}
        {backups.data && (
          <p>
            <StatusTag status={backups.data.dailyEnabled ? 'ok' : 'pending'} label={t('admin.backupDaily', { state: backups.data.dailyEnabled ? t('admin.on') : t('admin.off') })} />
          </p>
        )}
        <div className="row mt-4">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(async () => (await api.post('/api/admin/backups/run'), t('admin.backupDone')))}>
            {t('admin.runBackup')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void act(async () => t('admin.verifyDone', { tables: Object.keys((await api.post<{ tables: Record<string, number> }>('/api/admin/backups/verify')).tables).length }))}
          >
            {t('admin.verify')}
          </button>
        </div>
        {backups.data && backups.data.runs.length > 0 && (
          <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={t('admin.backups')}>
            <table>
              <caption className="visually-hidden">{t('admin.backups')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('common.time')}</th>
                  <th scope="col">{t('admin.kind')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col">{t('admin.file')}</th>
                  <th scope="col" className="num">
                    {t('admin.size')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {backups.data.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="stack-head nowrap">{formatTime(r.startedAt)}</td>
                    <td data-label={t('admin.kind')}>{r.kind}</td>
                    <td data-label={t('common.status')}>
                      <StatusTag status={r.status} />
                    </td>
                    <td data-label={t('admin.file')} className="small" translate="no">
                      {r.file?.split(/[\\/]/).pop() ?? '—'}
                    </td>
                    <td className="num" data-label={t('admin.size')}>
                      {r.sizeBytes ? `${formatNumber(Math.round(r.sizeBytes / 1024))} KiB` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel" aria-labelledby="retention-title">
        <h2 id="retention-title">{t('admin.retention')}</h2>
        {retention.data && <p className="muted">{t('admin.retentionIntro', { days: retention.data.retentionDays })}</p>}
        {retention.data && retention.data.operations.length === 0 && <p className="muted">{t('admin.noClosed')}</p>}
        <ul className="list">
          {retention.data?.operations.map((o) => (
            <li key={o.id} className="list-row">
              <span className="list-title">{o.name}</span>
              <StatusTag status={o.redacted_at ? 'ok' : 'pending'} label={o.redacted_at ? t('admin.done', { time: formatTime(o.redacted_at) }) : t('admin.due', { time: formatTime(o.due_at) })} />
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-danger mt-4" disabled={busy} onClick={() => void runRetention()}>
          {t('admin.runRetention')}
        </button>
      </section>
      {confirm.dialog}
    </>
  );
}

export function AccountPage() {
  const { t } = useTranslation();
  const { user } = useSession();
  return (
    <>
      <PageHead title={t('account.title')} />
      <div className="grid-2">
        <section className="panel" aria-labelledby="me-title">
          <h2 id="me-title">{t('account.details')}</h2>
          <dl className="dl">
            <dt>{t('common.name')}</dt>
            <dd>{user?.fullName}</dd>
            <dt>{t('common.mobile')}</dt>
            <dd className="tabular">{user?.mobile}</dd>
            <dt>{t('common.role')}</dt>
            <dd>{user ? t(`roles.${user.role}`) : ''}</dd>
            <dt>{t('common.organisation')}</dt>
            <dd>{user?.organisationName ?? '—'}</dd>
          </dl>
        </section>
        <section className="panel" aria-labelledby="pw-title">
          <h2 id="pw-title">{t('auth.changePassword')}</h2>
          <ChangePasswordPage forced={false} />
        </section>
      </div>
    </>
  );
}
