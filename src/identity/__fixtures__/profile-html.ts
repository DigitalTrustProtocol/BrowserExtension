export const nasaProfileHtml = `<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        "mainEntity": {
          "@type": "Person",
          "identifier": "11348282",
          "alternateName": "@NASA"
        }
      }
    </script>
  </head>
  <body>Public profile</body>
</html>`

export const conflictingProfileHtml = `<!doctype html>
<script type="application/ld+json">
  {"mainEntity":{"identifier":"111"}}
</script>
<script type="application/ld+json">
  {"mainEntity":{"identifier":"222"}}
</script>`
