export default async () => ({
  name: 'Action unsupported control', scenarios: ['resume'],
  async metadata() { return {}; },
  async run() { return { checks: [], unsupported: 'Not implemented in this test fixture' }; },
  async close() {},
});
