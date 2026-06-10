# Start backend (Django) in a new terminal window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; .\.venv\Scripts\Activate.ps1; python manage.py runserver"

# Start frontend (Vite) in a new terminal window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev"

# Wait a moment for Vite to spin up, then open the browser
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"
