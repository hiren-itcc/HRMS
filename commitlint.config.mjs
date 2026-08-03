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
