# Recipe Finder (Spoonacular)

1. Install Node 18+ (https://nodejs.org)
2. Create a free account at https://spoonacular.com/food-api and copy your API key from the console dashboard.
3. In this folder run:
   - Mac/Linux:  SPOONACULAR_API_KEY=your_key node server.js
   - Windows PowerShell:  $env:SPOONACULAR_API_KEY="your_key"; node server.js
4. Open http://localhost:3000

Deploying: upload these files to a Node host (Render, Railway, Fly.io) and set SPOONACULAR_API_KEY
as an environment variable there. Never put the key in index.html.
