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

/** Modern X profile shell: Schema.org microdata (no JSON-LD). */
export const nasaProfileMicrodataHtml = `<!doctype html>
<html>
  <head>
    <link rel="preload" as="image" imageSrcSet="https://pbs.twimg.com/profile_banners/11348282/1/600x200 600w" />
  </head>
  <body>
    <div itemScope itemType="https://schema.org/ProfilePage">
      <meta itemProp="url" content="https://x.com/NASA" />
      <div itemScope itemType="https://schema.org/Person">
        <meta itemProp="identifier" content="11348282" />
        <meta itemProp="additionalName" content="NASA" />
      </div>
      <div itemScope itemType="https://schema.org/SocialMediaPosting">
        <meta content="2081326380050940365" itemProp="identifier" />
        <meta content="11348282" itemProp="identifier" />
      </div>
    </div>
  </body>
</html>`

export const conflictingProfileHtml = `<!doctype html>
<script type="application/ld+json">
  {"mainEntity":{"identifier":"111"}}
</script>
<script type="application/ld+json">
  {"mainEntity":{"identifier":"222"}}
</script>`
