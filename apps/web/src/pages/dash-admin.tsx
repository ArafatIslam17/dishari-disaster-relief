import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { Download, Upload } from 'lucide-react';
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
  const status = params.get('status') ?? '';
  const data = useApiData((signal) => api.get<{ members: Member[] }>(`/api/members${status ? `?status=${status}` : ''}`, signal), [status]);
  const run = useAction(data.reload);
  const confirm = useConfirm();
  const [approveRole, setApproveRole] = useState<Record<string, string>>({});
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);

  const approve = (m: Member) =>
    run(() => api.post(`/api/members/${m.id}/approve`, m.role === 'OPERATION_ADMINISTRATOR' ? {} : { role: approveRole[m.id] ?? 'FIELD_VOLUNTEER' }), t('members.updated'));
  const reject = async (m: Member) => {
    const reason = await confirm.ask(`${t('common.reject')}: ${m.fullName}. ${t('members.rejectReason')}`, true);
    if (reason) await run(() => api.post(`/api/members/${m.id}/reject`, { reason }), t('members.updated'));
  };
  const deactivate = async (m: Member) => {
    if (await confirm.ask(t('members.deactivateConfirm', { name: m.fullName }))) await run(() => api.post(`/api/members/${m.id}/deactivate`), t('members.updated'));
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
    if (await confirm.ask(t('members.revokeConfirm', { device: label }))) await run(() => api.post(`/api/devices/${deviceId}/revoke`), t('members.updated'));
  };
  const changeRole = (m: Member, role: string) => run(() => api.post(`/api/members/${m.id}/role`, { role }), t('members.updated'));

  return (
    <>
      <h1>{admin ? t('admin.usersTitle') : t('members.title')}</h1>
      {admin && <p className="muted">{t('admin.usersIntro')}</p>}
      <div className="toolbar" role="tablist">
        <button type="button" role="tab" aria-selected={status === 'pending'} className={`btn ${status === 'pending' ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setParams({ status: 'pending' })}>
          {t('members.pending')}
        </button>
        <button type="button" role="tab" aria-selected={status === ''} className={`btn ${status === '' ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setParams({})}>
          {t('members.all')}
        </button>
      </div>
      {temp && (
        <Notice tone="warn">
          <p>{t('members.tempPasswordShown', { name: temp.name, password: '' })}</p>
          <p className="short-code" style={{ fontSize: '1.6rem' }}>
            {temp.password}
          </p>
          <button type="button" className="btn btn-quiet" onClick={() => setTemp(null)}>
            {t('common.close')}
          </button>
        </Notice>
      )}
      {data.loading && !data.data && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.members.length === 0 && <Empty title={t('common.noResults')} />}
      {data.data && data.data.members.length > 0 && (
        <div className="table-wrap">
          <table>
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
                    <td>{m.fullName}</td>
                    <td className="short-code-sm">{m.mobile}</td>
                    {admin && <td>{m.organisationName ?? '—'}</td>}
                    <td>
                      {orgMember && (m.status === 'active' || m.status === 'locked') && !self ? (
                        <select aria-label={t('members.assignRole')} value={m.role} onChange={(e) => void changeRole(m, e.target.value)}>
                          <option value="FIELD_VOLUNTEER">{t('roles.FIELD_VOLUNTEER')}</option>
                          <option value="GROUP_COORDINATOR">{t('roles.GROUP_COORDINATOR')}</option>
                        </select>
                      ) : (
                        t(`roles.${m.role}`)
                      )}
                    </td>
                    <td>
                      <StatusTag status={m.status} />
                      {m.lockedUntil && m.status === 'locked' && <div className="small muted">{t('members.lockedUntil', { time: formatTime(m.lockedUntil) })}</div>}
                    </td>
                    <td>
                      {m.devices.length === 0 ? (
                        <span className="muted">{t('members.noDevices')}</span>
                      ) : (
                        m.devices.map((d) => (
                          <div key={d.id} className="small">
                            {d.label} <StatusTag status={d.status} /> {d.lastSyncAt && t('members.lastSync', { time: formatTime(d.lastSyncAt) })}
                            {d.status === 'active' && (
                              <button type="button" className="link-button" onClick={() => void revoke(d.id, d.label)}>
                                {t('members.revoke')}
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </td>
                    <td>
                      <div className="form-actions" style={{ marginTop: 0 }}>
                        {m.status === 'pending' && (
                          <>
                            {orgMember && (
                              <select aria-label={t('members.approveAs')} value={approveRole[m.id] ?? 'FIELD_VOLUNTEER'} onChange={(e) => setApproveRole({ ...approveRole, [m.id]: e.target.value })}>
                                <option value="FIELD_VOLUNTEER">{t('roles.FIELD_VOLUNTEER')}</option>
                                <option value="GROUP_COORDINATOR">{t('roles.GROUP_COORDINATOR')}</option>
                              </select>
                            )}
                            <button type="button" className="btn btn-primary" onClick={() => void approve(m)}>
                              {t('common.approve')}
                            </button>
                            <button type="button" className="btn btn-quiet" onClick={() => void reject(m)}>
                              {t('common.reject')}
                            </button>
                          </>
                        )}
                        {(m.status === 'active' || m.status === 'locked') && !self && (
                          <>
                            <button type="button" className="btn btn-quiet" onClick={() => void issueTemp(m)}>
                              {t('members.tempPassword')}
                            </button>
                            <button type="button" className="btn btn-danger" onClick={() => void deactivate(m)}>
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
      toast(t('operations.created'));
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
      <h1>{t('operations.title')}</h1>
      <div className="grid-2">
        <section className="panel">
          <h2>{t('operations.title')}</h2>
          {mine.length === 0 ? (
            <p className="muted">{t('operations.none')}</p>
          ) : (
            <ul className="list">
              {mine.map((o) => (
                <li key={o.id}>
                  <Link className="list-row" to={`/app/operations/${o.id}`}>
                    <span>
                      <span className="list-title">{o.name}</span>
                      <br />
                      <span className="small muted">
                        {i18n.language === 'bn' ? o.disasterType.bn : o.disasterType.en}, {o.startDate}
                      </span>
                    </span>
                    <StatusTag status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <form className="panel" onSubmit={create}>
          <h2>{t('operations.create')}</h2>
          <TextField label={t('operations.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={issueText(issues.name)} />
          <SelectField label={t('operations.disasterType')} value={form.disasterTypeId} onChange={(e) => setForm({ ...form, disasterTypeId: e.target.value })} error={issueText(issues.disasterTypeId)}>
            <option value="">—</option>
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
    if (await confirm.ask(t('operations.closeConfirm', { name: o.name }))) {
      await runAreas(() => api.post(`/api/operations/${id}/close`, { confirm: true }), t('operations.created'));
      reloadOps();
    }
  };
  const rejectJoin = async (r: JoinRequest) => {
    const reason = await confirm.ask(`${t('common.reject')}: ${r.name}`, true);
    if (reason) await runJoins(() => api.post(`/api/operations/${id}/memberships/${r.organisationId}/reject`, { reason }), t('members.updated'));
  };

  return (
    <>
      <p>
        <Link to="/app/operations">{t('common.back')}</Link>
      </p>
      <div className="panel-head">
        <h1>
          {o.name} <StatusTag status={o.status} />
        </h1>
        {active && (
          <button type="button" className="btn btn-danger" onClick={() => void close()}>
            {t('operations.close')}
          </button>
        )}
      </div>
      <p className="muted">{o.closedAt ? t('operations.closed', { time: formatTime(o.closedAt) }) : t('operations.counts', { areas: o.areaCount, items: o.itemCount, members: o.memberCount })}</p>

      <section className="panel">
        <h2>{t('operations.joinRequests')}</h2>
        {joins.data && joins.data.requests.length === 0 && <p className="muted">{t('operations.noRequests')}</p>}
        {joins.data && joins.data.requests.length > 0 && (
          <div className="table-wrap">
            <table>
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
                    <td>{r.name}</td>
                    <td>
                      {r.contactName}, <span className="short-code-sm">{r.contactPhone}</span>
                    </td>
                    <td>{formatTime(r.requestedAt)}</td>
                    <td>
                      <StatusTag status={r.status} />
                      {r.rejectionReason && <div className="small muted">{r.rejectionReason}</div>}
                    </td>
                    <td>
                      {r.status === 'pending' && active && (
                        <div className="form-actions" style={{ marginTop: 0 }}>
                          <button type="button" className="btn btn-primary" onClick={() => void runJoins(() => api.post(`/api/operations/${id}/memberships/${r.organisationId}/approve`), t('operations.joinApproved'))}>
                            {t('common.approve')}
                          </button>
                          <button type="button" className="btn btn-quiet" onClick={() => void rejectJoin(r)}>
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

      <section className="panel">
        <h2>{t('operations.areas')}</h2>
        {active && (
          <>
            <form onSubmit={addArea} className="grid-2" noValidate>
              <TextField label={t('operations.upazila')} value={area.upazila} onChange={(e) => setArea({ ...area, upazila: e.target.value })} error={issueText(areaIssues.upazila)} />
              <TextField label={t('operations.union')} value={area.unionName} onChange={(e) => setArea({ ...area, unionName: e.target.value })} error={issueText(areaIssues.unionName)} />
              <TextField label={t('operations.ward')} value={area.ward} onChange={(e) => setArea({ ...area, ward: e.target.value })} error={issueText(areaIssues.ward)} />
              <TextField label={t('operations.upazilaBn')} value={area.upazilaBn} onChange={(e) => setArea({ ...area, upazilaBn: e.target.value })} lang="bn" />
              <TextField label={t('operations.unionBn')} value={area.unionBn} onChange={(e) => setArea({ ...area, unionBn: e.target.value })} lang="bn" />
              <div className="field" style={{ alignSelf: 'end' }}>
                <button type="submit" className="btn btn-primary">
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
          </>
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
        {areas.data && (
          <div className="table-wrap">
            <table>
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
                    <td>
                      {a.upazila}
                      {a.upazilaBn ? ` (${a.upazilaBn})` : ''}
                    </td>
                    <td>
                      {a.unionName}
                      {a.unionBn ? ` (${a.unionBn})` : ''}
                    </td>
                    <td>{a.ward}</td>
                    {active && (
                      <td>
                        <button type="button" className="link-button" onClick={() => void runAreas(() => api.del(`/api/operations/${id}/areas/${a.id}`), t('operations.setupSaved'))}>
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

      <section className="panel">
        <h2>{t('operations.items')}</h2>
        {active && (
          <form
            className="grid-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runItems(() => api.post(`/api/operations/${id}/items`, item), t('operations.setupSaved')).then((ok) => ok && setItem({ itemName: '', itemNameBn: '', unit: '' }));
            }}
          >
            <TextField label={t('operations.itemName')} value={item.itemName} onChange={(e) => setItem({ ...item, itemName: e.target.value })} />
            <TextField label={t('operations.itemNameBn')} value={item.itemNameBn} onChange={(e) => setItem({ ...item, itemNameBn: e.target.value })} lang="bn" />
            <TextField label={t('operations.unit')} value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} />
            <div className="field" style={{ alignSelf: 'end' }}>
              <button type="submit" className="btn btn-primary" disabled={!item.itemName || !item.unit}>
                {t('common.add')}
              </button>
            </div>
          </form>
        )}
        <ul className="list">
          {items.data?.items.map((i) => (
            <li key={i.id} className="list-row">
              <span>
                <strong>{i.itemName}</strong> {i.itemNameBn && <span lang="bn">({i.itemNameBn})</span>} <span className="muted">{i.unit}</span>{' '}
                {!i.active && <StatusTag status="deactivated" />}
              </span>
              {active && (
                <button type="button" className="btn btn-quiet" onClick={() => void runItems(() => api.patch(`/api/operations/${id}/items/${i.id}`, { active: !i.active }), t('operations.setupSaved'))}>
                  {i.active ? t('operations.retire') : t('operations.reuse')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2>{t('operations.team')}</h2>
          <ul className="list">
            {admins.data?.admins.map((a) => (
              <li key={a.userId} className="list-row">
                {a.fullName}
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addAdmin();
            }}
          >
            <TextField label={t('operations.addAdmin')} type="tel" value={adminMobile} onChange={(e) => setAdminMobile(e.target.value)} />
            <button type="submit" className="btn btn-quiet" disabled={!adminMobile}>
              {t('common.add')}
            </button>
          </form>
        </section>
        <section className="panel">
          <h2>{t('operations.invites')}</h2>
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
            <TextField label={t('operations.inviteOrg')} value={inviteOrg} onChange={(e) => setInviteOrg(e.target.value)} />
            <button type="submit" className="btn btn-quiet">
              {t('operations.createInvite')}
            </button>
          </form>
          {inviteLink && (
            <Notice tone="ok">
              {t('operations.inviteLink')}
              <br />
              <input readOnly value={inviteLink} onFocus={(e) => e.target.select()} aria-label={t('operations.invites')} />
            </Notice>
          )}
          <ul className="list">
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
      <h1>{t('operations.joinTitle')}</h1>
      <p className="muted">{t('operations.joinIntro')}</p>
      {active.length === 0 ? (
        <Empty title={t('operations.none')} />
      ) : (
        <ul className="list panel">
          {active.map((o) => (
            <li key={o.id} className="list-row">
              <span>
                <span className="list-title">{o.name}</span>
                <br />
                <span className="small muted">
                  {i18n.language === 'bn' ? o.disasterType.bn : o.disasterType.en}, {o.startDate}
                </span>
              </span>
              {o.membershipStatus && o.membershipStatus !== 'rejected' ? (
                <StatusTag status={o.membershipStatus} />
              ) : (
                <span>
                  {o.membershipStatus === 'rejected' && <StatusTag status="rejected" />}{' '}
                  <button type="button" className="btn btn-primary" onClick={() => void run(() => api.post(`/api/operations/${o.id}/join`), t('operations.requested'))}>
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
    const r = await api.get<{ entries: AuditEntry[]; nextBefore: string | null }>(`/api/audit?${qs}&before=${next}`);
    setPages((p) => [...p, r.entries]);
    setNext(r.nextBefore);
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
  return (
    <>
      <h1>{t('audit.title')}</h1>
      <p className="muted">{t('audit.intro')}</p>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)));
        }}
      >
        <TextField label={t('audit.action')} value={draft.action ?? ''} onChange={set('action')} placeholder="household." />
        <TextField label={t('audit.userId')} value={draft.userId ?? ''} onChange={set('userId')} />
        <TextField label={t('audit.organisationId')} value={draft.organisationId ?? ''} onChange={set('organisationId')} />
        <TextField label={t('audit.deviceId')} value={draft.deviceId ?? ''} onChange={set('deviceId')} />
        <TextField label={t('audit.from')} type="date" value={draft.from ?? ''} onChange={set('from')} />
        <TextField label={t('audit.to')} type="date" value={draft.to ?? ''} onChange={set('to')} />
        <button type="submit" className="btn btn-primary">
          {t('common.search')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => void exportCsv()}>
          <Download size={18} aria-hidden />
          {t('audit.export')}
        </button>
      </form>
      {first.loading && entries.length === 0 && <Loading rows={6} />}
      {first.error ? <ErrorState error={first.error} onRetry={first.reload} /> : null}
      {!first.loading && entries.length === 0 && !first.error && <Empty title={t('audit.none')} />}
      {entries.length > 0 && (
        <div className="table-wrap">
          <table>
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
                  <td>{formatTime(e.createdAt)}</td>
                  <td>
                    <code>{e.action}</code>
                    {e.changedFields?.length ? <div className="small muted">{e.changedFields.join(', ')}</div> : null}
                  </td>
                  <td className="small">{e.entityType}</td>
                  <td>{e.userName ?? '—'}</td>
                  <td>{e.organisationName ?? '—'}</td>
                  <td>{e.deviceLabel ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <button type="button" className="btn btn-quiet" onClick={() => void more()}>
          {t('common.more')}
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

export function AdminOrganisationsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'pending';
  const data = useApiData((signal) => api.get<{ organisations: Org[] }>(`/api/admin/organisations${status === 'all' ? '' : `?status=${status}`}`, signal), [status]);
  const run = useAction(data.reload);
  const confirm = useConfirm();
  const reject = async (o: Org) => {
    const reason = await confirm.ask(`${t('common.reject')}: ${o.name}`, true);
    if (reason) await run(() => api.post(`/api/admin/organisations/${o.id}/reject`, { reason }), t('members.updated'));
  };
  return (
    <>
      <h1>{t('admin.orgsTitle')}</h1>
      <p className="muted">{t('admin.orgsIntro')}</p>
      <div className="toolbar" role="tablist">
        {['pending', 'approved', 'rejected', 'all'].map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} className={`btn ${status === s ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setParams({ status: s })}>
            {s === 'all' ? t('members.all') : t(`statuses.${s}`)}
          </button>
        ))}
      </div>
      {data.loading && !data.data && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.organisations.length === 0 && <Empty title={t('common.noResults')} />}
      {data.data?.organisations.map((o) => (
        <section key={o.id} className="panel">
          <div className="panel-head">
            <h2>
              {o.name} {o.nameBn && <span lang="bn">({o.nameBn})</span>}
            </h2>
            <StatusTag status={o.status} />
          </div>
          <dl className="dl">
            <dt>{t('auth.orgType')}</dt>
            <dd>{t(`auth.orgTypes.${o.orgType}`, { defaultValue: o.orgType })}</dd>
            <dt>{t('admin.contact')}</dt>
            <dd>
              {o.contactName}, {o.contactPhone}
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
              <button type="button" className="btn btn-quiet" onClick={() => void reject(o)}>
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
      <h1>{t('admin.typesTitle')}</h1>
      <p className="muted">{t('admin.typesIntro')}</p>
      <form
        className="panel grid-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api.post('/api/admin/disaster-types', { ...form, active: true }), t('operations.setupSaved')).then((ok) => ok && setForm({ nameEn: '', nameBn: '' }));
        }}
      >
        <TextField label={t('admin.nameEn')} value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
        <TextField label={t('admin.nameBn')} value={form.nameBn} onChange={(e) => setForm({ ...form, nameBn: e.target.value })} lang="bn" />
        <div>
          <button type="submit" className="btn btn-primary" disabled={!form.nameEn || !form.nameBn}>
            {t('common.add')}
          </button>
        </div>
      </form>
      <ul className="list panel">
        {data.data?.disasterTypes.map((d) => (
          <li key={d.id} className="list-row">
            <span>
              {d.nameEn} <span lang="bn">({d.nameBn})</span> {!d.active && <StatusTag status="deactivated" />}
            </span>
            <button type="button" className="btn btn-quiet" onClick={() => void run(() => api.patch(`/api/admin/disaster-types/${d.id}`, { active: !d.active }), t('operations.setupSaved'))}>
              {d.active ? t('operations.retire') : t('operations.reuse')}
            </button>
          </li>
        ))}
      </ul>
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
  return (
    <>
      <h1>{t('admin.systemTitle')}</h1>
      <section className="panel">
        <h2>{t('admin.backups')}</h2>
        {backups.data?.databaseKind === 'pglite' && <Notice tone="warn">{t('admin.pglite')}</Notice>}
        {backups.data && <p>{t('admin.backupDaily', { state: backups.data.dailyEnabled ? t('admin.on') : t('admin.off') })}</p>}
        <div className="form-actions" style={{ marginTop: 0, marginBottom: 16 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(async () => (await api.post('/api/admin/backups/run'), t('admin.backupDone')))}>
            {t('admin.runBackup')}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => void act(async () => t('admin.verifyDone', { tables: Object.keys((await api.post<{ tables: Record<string, number> }>('/api/admin/backups/verify')).tables).length }))}
          >
            {t('admin.verify')}
          </button>
        </div>
        {backups.data && backups.data.runs.length > 0 && (
          <div className="table-wrap">
            <table>
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
                    <td>{formatTime(r.startedAt)}</td>
                    <td>{r.kind}</td>
                    <td>
                      <StatusTag status={r.status} />
                    </td>
                    <td className="small">{r.file?.split(/[\\/]/).pop() ?? '—'}</td>
                    <td className="num">{r.sizeBytes ? `${formatNumber(Math.round(r.sizeBytes / 1024))} KiB` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>{t('admin.retention')}</h2>
        {retention.data && <p>{t('admin.retentionIntro', { days: retention.data.retentionDays })}</p>}
        {retention.data && retention.data.operations.length === 0 && <p className="muted">{t('admin.noClosed')}</p>}
        <ul className="list">
          {retention.data?.operations.map((o) => (
            <li key={o.id} className="list-row">
              <span>{o.name}</span>
              <span className="muted">{o.redacted_at ? t('admin.done', { time: formatTime(o.redacted_at) }) : t('admin.due', { time: formatTime(o.due_at) })}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={() => void act(async () => t('admin.retentionRan', { n: (await api.post<{ redacted: unknown[] }>('/api/admin/retention/run')).redacted.length }))}
        >
          {t('admin.runRetention')}
        </button>
      </section>
    </>
  );
}

export function AccountPage() {
  const { t } = useTranslation();
  const { user } = useSession();
  return (
    <>
      <h1>{t('account.title')}</h1>
      <section className="panel">
        <dl className="dl">
          <dt>{t('common.name')}</dt>
          <dd>{user?.fullName}</dd>
          <dt>{t('common.mobile')}</dt>
          <dd>{user?.mobile}</dd>
          <dt>{t('common.role')}</dt>
          <dd>{user ? t(`roles.${user.role}`) : ''}</dd>
          <dt>{t('common.organisation')}</dt>
          <dd>{user?.organisationName ?? '—'}</dd>
        </dl>
      </section>
      <section className="panel">
        <h2>{t('auth.changePassword')}</h2>
        <ChangePasswordPage forced={false} />
      </section>
    </>
  );
}
