// Deliberate negative control for wrapper tests, not an upstream defect.
export default async () => ({
  name: 'Action negative control', scenarios: ['persistence'],
  async metadata() { return { evidencePolicy: 'summary-only-v1' }; },
  async run() { return { checks: [{ name: 'Deliberately false assertion', passed: false }] }; },
  async close() {},
});
