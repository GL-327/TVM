/**
 * Shown when the interface cannot be reached. A media appliance must never
 * present a black screen: the user needs to know it is still trying.
 */
export function bootErrorPage(target: string): string {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>TVM</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: grid;
        place-content: center;
        gap: 16px;
        background: #0a0d12;
        color: #f4f7fb;
        font-family: "Segoe UI", system-ui, sans-serif;
        text-align: center;
        cursor: none;
      }
      h1 { margin: 0; font-size: 48px; letter-spacing: 0.12em; color: #f2b355; }
      p { margin: 0; font-size: 28px; color: #9ba7b8; }
      code { font-size: 22px; color: #6b7686; }
    </style>
  </head>
  <body>
    <h1>TVM</h1>
    <p>Starting the interface&hellip;</p>
    <code>${target.replace(/[<>&"]/g, '')}</code>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
