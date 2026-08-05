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
        'mail',
        'reports',
        'settings',
        'db',
        'ci',
        'docker',
        'deps',
        'docs',
      ],
    ],
  },
};
