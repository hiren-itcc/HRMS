export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        'web',
        'api',
        'ui',
        'shared',
        'types',
        'config',
        'auth',
        'org',
        'employees',
        'attendance',
        'leave',
        'documents',
        'announcements',
        // Shipped after this list was written, so it was the one module
        // missing from it — every other module is named here.
        'payroll',
        'letters',
        'onboarding',
        // The exit side: resignation, offboarding, and the probation/notice
        // rules the two share.
        'lifecycle',
        'resignation',
        'offboarding',
        // The money half of the exit. Routed under /payroll, but its own
        // module — a settlement is not a payroll run.
        'settlements',
        // The register that makes the exit checklist's asset line mean
        // something.
        'assets',
        'recruitment',
        // Two more that shipped after the list was written, exactly as payroll
        // did above. The rule is a warning rather than an error, so a missing
        // scope never blocks a commit — which is also why nobody noticed.
        'expenses',
        'careers',
        // Goals, review cycles and reviews.
        'performance',
        'notifications',
        // Tickets, threads, and the desks they route to.
        'helpdesk',
        'wfh',
        'mail',
        'reports',
        'settings',
        'db',
        'ci',
        // The test layers are their own concern: apps/e2e and apps/api/test.
        'test',
        'docker',
        'deps',
        'docs',
      ],
    ],
  },
};
