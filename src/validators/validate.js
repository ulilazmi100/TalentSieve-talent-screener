const Ajv = require('ajv');
const { cvSchema, projectSchema } = require('./schemas');
const ajv = new Ajv({ allErrors: true, useDefaults: true });
const validateCv = ajv.compile(cvSchema);
const validateProject = ajv.compile(projectSchema);

function validateCvOutput(obj) {
  const valid = validateCv(obj);
  return { valid, errors: valid ? null : validateCv.errors };
}

function validateProjectOutput(obj) {
  const valid = validateProject(obj);
  return { valid, errors: valid ? null : validateProject.errors };
}

module.exports = { validateCvOutput, validateProjectOutput };
