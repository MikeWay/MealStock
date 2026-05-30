@echo off
title Meal Stock Control Server
color 0A

echo.
echo  ============================================
echo   Meal Stock Control Server (PostgreSQL)
echo  ============================================
echo.

:: Check Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  ERROR: Node.js is not installed.
    echo.
    echo  Please download and install Node.js from:
    echo  https://nodejs.org  (choose the LTS version)
    echo.
    pause
    exit /b 1
)

:: Install node_modules if missing
if not exist "node_modules\" (
    echo  Installing dependencies for the first time...
    npm install
    echo.
)

:: Build TypeScript if dist is missing
if not exist "dist\server.js" (
    echo  Building server...
    npm run build
    if %errorlevel% neq 0 (
        color 0C
        echo.
        echo  Build failed. Check the error above.
        echo.
        pause
        exit /b 1
    )
    echo.
)

:: Run DB setup if stockdata has never been initialised
:: (we use a small sentinel file so setup only runs once)
if not exist ".db_initialised" (
    echo  Setting up database for the first time...
    echo  (Make sure PostgreSQL is running and src\db-config.ts is correct)
    echo.
    node dist\setup-db.js
    if %errorlevel% neq 0 (
        color 0C
        echo.
        echo  Database setup failed. Check the error above.
        echo  Edit src\db-config.ts with your PostgreSQL password and try again.
        echo.
        pause
        exit /b 1
    )
    echo. > .db_initialised
    echo  Database ready.
    echo.
)

echo  Starting server...
echo  Open your browser or tablets to the Network address shown below.
echo  Keep this window open while using the app.
echo  Press Ctrl+C to stop the server.
echo.

node dist\server.js

echo.
echo  Server stopped.
pause
