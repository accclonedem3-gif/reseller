@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0start-local-bot-test.ps1" %*
