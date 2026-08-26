const fs = require('fs');

let ui = fs.readFileSync('src/app/campaigns/new/page.tsx', 'utf8');

// Remove creative_id input
ui = ui.replace(
  /<div className="flex justify-between">\s*<span className="text-gray-500">Creative ID.*?<\/div>/s,
  `<div className="flex justify-between">
              <span className="text-gray-500">Creative</span>
              <span className="font-medium text-red-600">No creative selected (Required before approval)</span>
            </div>`
);

// Remove creative_id from form state initialization
ui = ui.replace(/creative_id:\s*['"](.*?)['"]/g, '');

// Ensure payload generation doesn't refer to it
ui = ui.replace(/payload\.creative_id = undefined;/g, '');

fs.writeFileSync('src/app/campaigns/new/page.tsx', ui);
console.log('UI edited');
