import type { Role } from '@relief/shared';

/** Where each role lands after log-in. Volunteers work in the field app; everyone else in the dashboard. */
export function homePath(role: Role): string {
  switch (role) {
    case 'FIELD_VOLUNTEER':
      return '/field';
    case 'GROUP_COORDINATOR':
      return '/app/coverage';
    case 'OPERATION_ADMINISTRATOR':
      return '/app/operations';
    case 'SYSTEM_ADMINISTRATOR':
      return '/app/admin/organisations';
    case 'OBSERVER':
      return '/app/coverage';
  }
}
