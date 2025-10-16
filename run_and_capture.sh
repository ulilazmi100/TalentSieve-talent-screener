#!/usr/bin/env bash
# run_and_capture.sh
# Usage: bash run_and_capture.sh
# This script runs the server and worker in the background (demo mode) and captures logs to files.
set -euo pipefail
DEMO=${DEMO_MODE:-true}
PORT=${PORT:-3000}

echo "Ensuring node modules installed..."
if [ ! -d "node_modules" ]; then
  npm install
fi

mkdir -p logs

echo "Starting server (logs/server.log) ..."
DEMO_MODE=$DEMO PORT=$PORT node src/server.js 2>&1 | sed -u 's/^/[server] /' >> logs/server.log &
SERVER_PID=$!
echo "server pid=$SERVER_PID"

echo "Starting worker (logs/worker.log) ..."
DEMO_MODE=$DEMO npm run worker 2>&1 | sed -u 's/^/[worker] /' >> logs/worker.log &
WORKER_PID=$!
echo "worker pid=$WORKER_PID"

echo "Give services a few seconds to start..."
sleep 3

echo "Uploading sample files and creating job..."
bash scripts/run_sample_job.sh | tee logs/run_sample_job.log

echo "Tailing logs (press Ctrl-C to stop)..."
tail -n +1 -f logs/server.log logs/worker.log logs/run_sample_job.log || true

# On exit, attempt to kill background processes
trap 'echo "Stopping pids $SERVER_PID $WORKER_PID"; kill $SERVER_PID $WORKER_PID 2>/dev/null || true' EXIT
