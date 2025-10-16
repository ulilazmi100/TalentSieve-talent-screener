#!/usr/bin/env bash
set -e
# Use provided HOST or construct from PORT (env) or default to 3000 to match .env in many setups
HOST=${HOST:-http://localhost:${PORT:-3000}}
CV=tests/sample_data/sample_cv.pdf
PROJ=tests/sample_data/sample_project.pdf

echo "Using HOST=$HOST"
echo "Uploading sample files..."
RESPONSE=$(curl -s -X POST "$HOST/upload" -F "cv=@$CV" -F "project_report=@$PROJ")
echo "Upload response: $RESPONSE"

# Helper: prefer jq if available, otherwise use node json parser
if command -v jq >/dev/null 2>&1; then
  cv_id=$(echo "$RESPONSE" | jq -r '.cv_id // .cv_doc_id // .cvDocId // .cvId // empty')
  project_id=$(echo "$RESPONSE" | jq -r '.project_id // .report_doc_id // .reportDocId // .projectId // empty')
else
  # Node fallback - robustly extract multiple possible keys
  cv_id=$(node -e "const s=process.argv[1]||'{}'; try{const o=JSON.parse(s); console.log(o.cv_id||o.cv_doc_id||o.cvDocId||o.cvId||'');}catch(e){console.log('')}" "$RESPONSE")
  project_id=$(node -e "const s=process.argv[1]||'{}'; try{const o=JSON.parse(s); console.log(o.project_id||o.report_doc_id||o.reportDocId||o.projectId||'');}catch(e){console.log('')}" "$RESPONSE")
fi

if [ -z "$cv_id" ] || [ "$cv_id" == "null" ]; then
  echo "Upload failed or did not return expected keys. Full response:"
  echo "$RESPONSE"
  exit 1
fi

echo "Creating evaluation job..."
JOB=$(curl -s -X POST "$HOST/evaluate" -H "Content-Type: application/json" -d '{"job_title":"Backend Engineer","cv_id":"'${cv_id}'","project_id":"'${project_id}'"}')
echo "Evaluate response: $JOB"

if command -v jq >/dev/null 2>&1; then
  job_id=$(echo "$JOB" | jq -r '.id // .job_id // empty')
else
  job_id=$(node -e "const s=process.argv[1]||'{}'; try{const o=JSON.parse(s); console.log(o.id||o.job_id||'');}catch(e){console.log('')}" "$JOB")
fi

if [ -z "$job_id" ] || [ "$job_id" == "null" ]; then
  echo "Evaluate failed or did not return job id. Full response:"
  echo "$JOB"
  exit 1
fi

echo "Polling job result: $job_id"
for i in {1..30}; do
  R=$(curl -s "$HOST/result/$job_id")
  if command -v jq >/dev/null 2>&1; then
    status=$(echo "$R" | jq -r '.status // empty')
  else
    status=$(node -e "const s=process.argv[1]||'{}'; try{const o=JSON.parse(s); console.log(o.status||'');}catch(e){console.log('')}" "$R")
  fi
  echo "status=$status"
  if [ "$status" == "completed" ]; then
    echo "RESULT:"
    if command -v jq >/dev/null 2>&1; then
      echo "$R" | jq
    else
      echo "$R"
    fi
    exit 0
  fi
  sleep 1
done

echo "Job did not complete in time"
echo "Last response:"
echo "$R"
exit 2
