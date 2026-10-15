@echo off
chcp 65001 >nul
rem 在這台電腦開錯誤分析引擎（給老師後台「用這台電腦分析」用）。視窗開著就能用，關掉就停止。
cd /d "%~dp0"
if not exist .brain_key (
  echo 找不到 .brain_key，請先完成 Cloud Run 部署設定
  pause
  exit /b 1
)
set /p BRAIN_KEY=<.brain_key
set PYTHONPATH=%~dp0
set PYTHONIOENCODING=utf-8
echo 本機分析引擎啟動中（第一次約 30 秒載入語言模型）…
echo 啟動後回到老師後台，選「用這台電腦分析」再按分析。視窗不要關。
.venv\Scripts\python -m uvicorn main:app --app-dir cloudrun --host 127.0.0.1 --port 8765
pause
