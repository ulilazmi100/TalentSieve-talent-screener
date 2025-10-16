module.exports = {
  cvSchema: {
    type: 'object',
    properties: {
      technical_skills: { type: 'integer', minimum: 1, maximum: 5 },
      experience_level: { type: 'integer', minimum: 1, maximum: 5 },
      relevant_achievements: { type: 'integer', minimum: 1, maximum: 5 },
      cultural_fit: { type: 'integer', minimum: 1, maximum: 5 },
      cv_feedback: { type: 'string' }
    },
    required: ['technical_skills','experience_level','relevant_achievements','cultural_fit']
  },

  projectSchema: {
    type: 'object',
    properties: {
      correctness: { type: 'integer', minimum: 1, maximum: 5 },
      code_quality: { type: 'integer', minimum: 1, maximum: 5 },
      resilience: { type: 'integer', minimum: 1, maximum: 5 },
      documentation: { type: 'integer', minimum: 1, maximum: 5 },
      creativity: { type: 'integer', minimum: 1, maximum: 5 },
      project_feedback: { type: 'string' }
    },
    required: ['correctness','code_quality','resilience','documentation','creativity']
  }
};
