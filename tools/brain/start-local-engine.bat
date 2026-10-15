@echo off
rem Local error-analysis engine for the teacher admin ("use this computer"). Keep this window open while analyzing.
cd /d "%~dp0"
if not exist .brain_key (
  echo [ERROR] .brain_key not found.
  pause
  exit /b 1
)
set /p BRAIN_KEY=<.brain_key
set PYTHONPATH=%~dp0
set PYTHONIOENCODING=utf-8
set HF_HOME=%~dp0models
echo Starting local analysis engine (first start loads the models, about 30 seconds)...
echo When you see "Uvicorn running", go back to the admin page. Do not close this window.
.venv\Scripts\python -m uvicorn main:app --app-dir cloudrun --host 127.0.0.1 --port 8765
pause
