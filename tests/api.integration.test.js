const request = require('supertest');
const path = require('path');

let server;
beforeAll(() => {
  process.env.DEMO_MODE = 'true';
  server = require('../src/server');
});

afterAll(async () => { if (server && typeof server.shutdown === 'function') await server.shutdown(); });

test('upload and evaluate flow (demo mode) and result shape', async () => {
  const cvPath = path.join(__dirname, 'sample_data', 'sample_cv.pdf');
  const projPath = path.join(__dirname, 'sample_data', 'sample_project.pdf');

  const resUpload = await request(server)
    .post('/upload')
    .attach('cv', cvPath)
    .attach('project_report', projPath)
    .expect(200);

  const { cv_id, project_id } = resUpload.body;
  expect(cv_id).toBeDefined();
  expect(project_id).toBeDefined();

  const resEval = await request(server).post('/evaluate').send({ job_title: 'Backend Engineer', cv_id, project_id }).expect(200);
  expect(resEval.body.id).toBeDefined();

  const jobId = resEval.body.id;
  for (let i=0;i<20;i++) {
    const r = await request(server).get(`/result/${jobId}`);
    if (r.body.status === 'completed') {
      expect(r.body.result).toHaveProperty('cv_match_rate');
      expect(r.body.result).toHaveProperty('cv_feedback');
      expect(r.body.result).toHaveProperty('project_score');
      expect(r.body.result).toHaveProperty('project_feedback');
      expect(r.body.result).toHaveProperty('overall_summary');
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('job not completed in time');
});
