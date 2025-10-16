function countKeywords(text, keywords) {
  if (!text) return 0;
  const t = text.toLowerCase();
  let count = 0;
  for (const k of keywords) {
    const re = new RegExp('\\b' + k.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&') + '\\b', 'gi');
    const m = t.match(re);
    if (m) count += m.length;
  }
  return count;
}

function mapCountToScore(count, thresholds = [0,2,4,6,8]) {
  if (count >= thresholds[4]) return 5;
  if (count >= thresholds[3]) return 4;
  if (count >= thresholds[2]) return 3;
  if (count >= thresholds[1]) return 2;
  return 1;
}

function parseYearsFromText(text) {
  if (!text) return 0;
  const re = /([0-9]{1,2})\s+(?:years|yrs|year)/gi;
  let total = 0; let m;
  while ((m = re.exec(text)) !== null) {
    const v = parseInt(m[1],10);
    if (!isNaN(v)) total += v;
  }
  return total;
}

function scoreCvHeuristic(cvText) {
  const backendKeywords = ['node','express','fastify','rust','actix','go','golang','python','django','flask','java','spring','postgres','mysql','mongodb','redis','kafka','grpc','rest','graphql','aws','gcp','azure','docker','kubernetes','lambda','s3'];
  const achievementsKeywords = ['%','increase','decrease','reduced','improved','scaled','performance','latency','throughput','million','billion','users','kpi','metric','saved','cost'];
  const cultureKeywords = ['team','collaborat','agile','scrum','peer','communicat','ownership','initiative','mentor','diversity','inclusive'];

  const techCount = countKeywords(cvText, backendKeywords);
  const techScore = mapCountToScore(techCount);

  const years = parseYearsFromText(cvText);
  let expScore = 1;
  if (years >= 8) expScore = 5;
  else if (years >= 5) expScore = 4;
  else if (years >= 3) expScore = 3;
  else if (years >= 1) expScore = 2;

  const achCount = countKeywords(cvText, achievementsKeywords);
  const achScore = mapCountToScore(achCount, [0,1,2,4,6]);

  const cultCount = countKeywords(cvText, cultureKeywords);
  const cultScore = mapCountToScore(cultCount, [0,1,2,3,5]);

  const feedbackParts = [];
  if (techScore >= 4) feedbackParts.push('Strong backend tech footprint');
  else if (techScore === 3) feedbackParts.push('Moderate backend skills');
  else feedbackParts.push('Limited explicit backend keywords');

  if (years > 0) feedbackParts.push(`${years} years experience detected`);
  if (achScore >= 3) feedbackParts.push('Has measurable achievements');
  if (cultScore >= 3) feedbackParts.push('Mentions collaboration/culture keywords');

  const feedback = feedbackParts.join('. ') + '.';

  return {
    technical_skills: techScore,
    experience_level: expScore,
    relevant_achievements: achScore,
    cultural_fit: cultScore,
    cv_feedback: feedback
  };
}

function scoreProjectHeuristic(projectText) {
  const correctnessKeywords = ['correct','passed','test','unit test','integration test','verified','validated','assert'];
  const codeQualityKeywords = ['clean','readable','well-structured','modular','refactor','lint','type','types','static analysis'];
  const resilienceKeywords = ['retry','backoff','idempotent','rate limit','circuit breaker','timeout','retry','failover','monitoring','observability'];
  const docKeywords = ['readme','documentation','how to','usage','setup','architecture','diagram','design'];
  const creativityKeywords = ['novel','innovative','creative','unique','heuristic','uncommon','first'];

  const corr = countKeywords(projectText, correctnessKeywords);
  const cq = countKeywords(projectText, codeQualityKeywords);
  const res = countKeywords(projectText, resilienceKeywords);
  const doc = countKeywords(projectText, docKeywords);
  const cre = countKeywords(projectText, creativityKeywords);

  const correctness = mapCountToScore(corr, [0,1,2,3,5]);
  const code_quality = mapCountToScore(cq, [0,1,2,3,5]);
  const resilience = mapCountToScore(res, [0,1,2,3,4]);
  const documentation = mapCountToScore(doc, [0,1,1,2,4]);
  const creativity = mapCountToScore(cre, [0,1,1,2,3]);

  const feedback = [];
  if (corr >= 1) feedback.push('Includes testing or validation mentions');
  if (res >= 1) feedback.push('Addresses resilience or retries');
  if (doc >= 1) feedback.push('Contains documentation cues');
  if (cre >= 1) feedback.push('Shows creative elements');

  return {
    correctness,
    code_quality,
    resilience,
    documentation,
    creativity,
    project_feedback: feedback.join('. ') || 'No strong signals detected.'
  };
}

module.exports = { scoreCvHeuristic, scoreProjectHeuristic };
