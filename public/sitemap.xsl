<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  exclude-result-prefixes="s xhtml image">
  <xsl:output method="html" version="5.0" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat" />

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#b70d2c" />
        <title>XML Sitemap | Khuzestan Yeast Co.</title>
        <style><![CDATA[
          :root {
            color-scheme: light dark;
            --page: #f5f6f8;
            --surface: #ffffff;
            --surface-soft: #fafafb;
            --ink: #202431;
            --muted: #687081;
            --line: #e7e8ec;
            --accent: #bd1232;
            --accent-dark: #8f0c25;
            --accent-soft: #fff0f3;
            --hero: #76091f;
            --hero-deep: #4f0718;
            --shadow: 0 14px 38px rgba(34, 20, 27, .07);
          }
          * { box-sizing: border-box; }
          html { min-width: 320px; background: var(--page); }
          body {
            margin: 0;
            color: var(--ink);
            background: var(--page);
            font: 15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          a { color: inherit; }
          .hero {
            position: relative;
            overflow: hidden;
            padding: 24px max(24px, calc((100vw - 1200px) / 2)) 42px;
            color: #fff;
            background:
              radial-gradient(ellipse at 83% 12%, rgba(240, 66, 99, .38), transparent 38%),
              linear-gradient(118deg, var(--hero) 0%, #a20e2e 57%, var(--hero-deep) 100%);
          }
          .hero::after {
            position: absolute;
            right: -115px;
            bottom: -260px;
            width: 500px;
            height: 500px;
            border: 1px solid rgba(255,255,255,.12);
            border-radius: 50%;
            box-shadow: 0 0 0 42px rgba(255,255,255,.035), 0 0 0 84px rgba(255,255,255,.025);
            content: "";
            pointer-events: none;
          }
          .hero-inner, .main-inner { width: min(1200px, 100%); margin: 0 auto; }
          .brandline { display: flex; align-items: center; gap: 11px; font-size: 14px; font-weight: 700; letter-spacing: .01em; }
          .brandline img { display: block; width: 38px; height: 38px; border: 1px solid rgba(255,255,255,.3); border-radius: 11px; }
          .brand-tag {
            margin-left: 3px;
            padding: 4px 9px;
            border: 1px solid rgba(255,255,255,.24);
            border-radius: 999px;
            color: rgba(255,255,255,.8);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .12em;
          }
          .hero-copy { position: relative; z-index: 1; display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; margin-top: 31px; }
          .eyebrow { margin: 0 0 8px; color: #ffc5d0; font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
          h1 { margin: 0; font-size: clamp(32px, 5vw, 50px); line-height: 1.08; letter-spacing: -.045em; }
          .intro { max-width: 650px; margin: 12px 0 0; color: rgba(255,255,255,.82); font-size: 15px; }
          .robots-link {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            gap: 9px;
            padding: 11px 15px;
            border: 1px solid rgba(255,255,255,.24);
            border-radius: 10px;
            color: #fff;
            background: rgba(255,255,255,.08);
            font-size: 13px;
            font-weight: 650;
            text-decoration: none;
            transition: background .18s ease, border-color .18s ease;
          }
          .robots-link:hover { border-color: rgba(255,255,255,.48); background: rgba(255,255,255,.15); }
          .stats { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 30px; }
          .stat {
            display: flex;
            align-items: center;
            gap: 13px;
            min-height: 76px;
            padding: 13px 16px;
            border: 1px solid rgba(255,255,255,.16);
            border-radius: 13px;
            background: rgba(255,255,255,.075);
            backdrop-filter: blur(8px);
          }
          .stat-value { display: block; color: #fff; font-size: 24px; font-variant-numeric: tabular-nums; font-weight: 750; line-height: 1.1; }
          .stat-label { display: block; margin-top: 4px; color: rgba(255,255,255,.72); font-size: 12px; }
          main { padding: 34px 24px 56px; }
          .section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 0 0 17px; }
          .section-heading .eyebrow { margin-bottom: 5px; color: var(--accent); }
          h2 { margin: 0; font-size: 23px; line-height: 1.25; letter-spacing: -.025em; }
          .page-count { padding: 6px 11px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); background: var(--surface); font-size: 12px; white-space: nowrap; }
          .table-shell { overflow: hidden; border: 1px solid var(--line); border-radius: 15px; background: var(--surface); box-shadow: var(--shadow); }
          .table-scroll { overflow-x: auto; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          caption { text-align: left; }
          thead { background: var(--surface-soft); }
          th {
            height: 47px;
            padding: 0 13px;
            border-bottom: 1px solid var(--line);
            color: var(--muted);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .09em;
            text-align: left;
            text-transform: uppercase;
          }
          th:first-child, td:first-child { width: 56px; padding-left: 20px; }
          th:nth-child(2) { width: 42%; }
          th:nth-child(3) { width: 20%; }
          th:nth-child(4) { width: 16%; }
          th:nth-child(5) { width: 112px; }
          td { padding: 12px 13px; border-bottom: 1px solid var(--line); vertical-align: middle; }
          tbody tr:last-child td { border-bottom: 0; }
          tbody tr { transition: background .14s ease; }
          tbody tr:hover { background: var(--surface-soft); }
          .row-number { color: #9298a4; font-size: 11px; font-variant-numeric: tabular-nums; }
          .page-cell { min-width: 0; }
          .page-url { overflow-wrap: anywhere; color: var(--ink); font-size: 12px; font-weight: 650; line-height: 1.45; }
          .page-url a { text-decoration: none; text-decoration-color: rgba(189,18,50,.28); text-underline-offset: 3px; }
          .page-url a:hover { color: var(--accent); text-decoration: underline; }
          .page-type { display: inline-block; margin-top: 6px; padding: 2px 7px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 9px; font-weight: 700; letter-spacing: .04em; }
          .lang-list { display: flex; flex-wrap: wrap; gap: 4px; }
          .lang-pill { min-width: 29px; padding: 3px 5px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); background: var(--surface-soft); font-size: 9px; font-weight: 800; line-height: 1.2; text-align: center; }
          .lastmod { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
          .empty { color: #a2a7b0; font-size: 12px; }
          .image-cell { text-align: center; }
          .preview {
            display: inline-flex;
            width: 58px;
            height: 44px;
            overflow: hidden;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--line);
            border-radius: 7px;
            background: var(--surface-soft);
          }
          .preview img { display: block; width: 100%; height: 100%; object-fit: cover; }
          footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 16px; color: var(--muted); font-size: 11px; }
          footer a { color: var(--accent); text-decoration: none; }
          footer a:hover { text-decoration: underline; }
          .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
          @media (max-width: 740px) {
            .hero { padding: 20px 20px 30px; }
            .hero-copy { align-items: flex-start; flex-direction: column; gap: 17px; margin-top: 26px; }
            .robots-link { padding: 9px 12px; }
            .stats { gap: 8px; margin-top: 22px; }
            .stat { min-height: 69px; padding: 10px; }
            .stat-value { font-size: 21px; }
            main { padding: 25px 16px 42px; }
            .table-shell { overflow: visible; border: 0; background: transparent; box-shadow: none; }
            .table-scroll { overflow: visible; }
            table, tbody, tr, td { display: block; width: 100%; }
            thead, .number-cell { display: none; }
            tbody tr { overflow: hidden; margin: 0 0 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: 0 4px 14px rgba(34,20,27,.035); }
            tbody tr:hover { background: var(--surface); }
            td { display: grid; grid-template-columns: 92px minmax(0,1fr); align-items: center; gap: 12px; padding: 10px 13px; border-bottom: 1px solid var(--line); }
            td::before { color: var(--muted); content: attr(data-label); font-size: 10px; font-weight: 750; letter-spacing: .03em; }
            tbody tr td:last-child { border-bottom: 0; }
            .page-cell { padding-top: 13px; padding-bottom: 13px; }
            .page-url { font-size: 11px; }
            .page-type { margin-top: 5px; }
            .image-cell { text-align: left; }
            .preview { width: 56px; height: 42px; }
            footer { flex-direction: column; gap: 5px; }
          }
          @media (max-width: 430px) {
            .brandline { gap: 8px; font-size: 12px; }
            .brandline img { width: 33px; height: 33px; }
            .brand-tag { padding: 3px 7px; font-size: 8px; }
            .stats { grid-template-columns: 1fr; }
            .stat { min-height: 57px; }
            .section-heading { align-items: flex-start; flex-direction: column; }
            td { grid-template-columns: 78px minmax(0,1fr); gap: 8px; }
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --page: #14161b;
              --surface: #1d2027;
              --surface-soft: #232630;
              --ink: #f0f1f4;
              --muted: #a6abba;
              --line: #333743;
              --accent: #ff647e;
              --accent-dark: #ff7c90;
              --accent-soft: #351c25;
              --hero: #5b0a1c;
              --hero-deep: #2b0912;
              --shadow: 0 14px 38px rgba(0,0,0,.22);
            }
            .section-heading .eyebrow { color: #ff8497; }
            .lang-pill { background: #272a33; }
            .page-type { border-color: #393d49; }
          }
          @media (prefers-color-scheme: dark) and (max-width: 740px) {
            tbody tr { box-shadow: 0 4px 14px rgba(0,0,0,.14); }
          }
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
          }
        ]]></style>
      </head>
      <body>
        <header class="hero">
          <div class="hero-inner">
            <div class="brandline">
              <img src="/assets/brand/favicon-64.png" alt="" width="38" height="38" />
              <span>Khuzestan Yeast Co.</span>
              <span class="brand-tag">PUBLIC SITE</span>
            </div>
            <div class="hero-copy">
              <div>
                <p class="eyebrow">Search index</p>
                <h1>XML Sitemap</h1>
                <p class="intro">A clear overview of the public pages available to search engines. This visual view does not change the standard sitemap data.</p>
              </div>
              <a class="robots-link" href="/robots.txt">Crawler instructions <span aria-hidden="true">↗</span></a>
            </div>
            <div class="stats" aria-label="Sitemap summary">
              <div class="stat"><div><span class="stat-value"><xsl:value-of select="count(s:urlset/s:url)" /></span><span class="stat-label">Canonical URLs</span></div></div>
              <div class="stat"><div><span class="stat-value"><xsl:value-of select="count(s:urlset/s:url/xhtml:link[not(@hreflang='x-default')])" /></span><span class="stat-label">Language alternate links</span></div></div>
              <div class="stat"><div><span class="stat-value"><xsl:value-of select="count(s:urlset/s:url[s:image/image:loc])" /></span><span class="stat-label">Pages with image previews</span></div></div>
            </div>
          </div>
        </header>

        <main>
          <div class="main-inner">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Index overview</p>
                <h2>Public canonical pages</h2>
              </div>
              <span class="page-count"><xsl:value-of select="count(s:urlset/s:url)" /> URLs</span>
            </div>
            <div class="table-shell">
              <div class="table-scroll">
                <table>
                  <caption class="sr-only">Canonical public URLs, available language versions, last modification dates, and sitemap images.</caption>
                  <thead>
                    <tr>
                      <th scope="col">No.</th>
                      <th scope="col">Page</th>
                      <th scope="col">Languages</th>
                      <th scope="col">Last modified</th>
                      <th scope="col">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    <xsl:for-each select="s:urlset/s:url">
                      <xsl:sort select="s:loc" data-type="text" order="ascending" />
                      <tr>
                        <td class="number-cell" data-label="No."><span class="row-number"><xsl:number value="position()" format="001" /></span></td>
                        <td class="page-cell" data-label="Page">
                          <div class="page-url"><a href="{s:loc}"><xsl:value-of select="s:loc" /></a></div>
                          <span class="page-type">
                            <xsl:choose>
                              <xsl:when test="contains(s:loc, '/products/')">Product</xsl:when>
                              <xsl:when test="contains(s:loc, '/blog/')">Article</xsl:when>
                              <xsl:when test="contains(s:loc, '/shop')">Shop</xsl:when>
                              <xsl:otherwise>Site page</xsl:otherwise>
                            </xsl:choose>
                          </span>
                        </td>
                        <td class="languages-cell" data-label="Language versions">
                          <xsl:choose>
                            <xsl:when test="xhtml:link[not(@hreflang='x-default')]">
                              <div class="lang-list">
                                <xsl:for-each select="xhtml:link[not(@hreflang='x-default')]">
                                  <span class="lang-pill" title="{@hreflang}"><xsl:value-of select="translate(@hreflang, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')" /></span>
                                </xsl:for-each>
                              </div>
                            </xsl:when>
                            <xsl:otherwise><span class="empty">Not localized</span></xsl:otherwise>
                          </xsl:choose>
                        </td>
                        <td class="lastmod-cell" data-label="Last modified">
                          <xsl:choose>
                            <xsl:when test="s:lastmod"><time class="lastmod" datetime="{s:lastmod}"><xsl:value-of select="substring(s:lastmod, 1, 10)" /></time></xsl:when>
                            <xsl:otherwise><span class="empty">Not specified</span></xsl:otherwise>
                          </xsl:choose>
                        </td>
                        <td class="image-cell" data-label="Sitemap image">
                          <xsl:choose>
                            <xsl:when test="s:image/image:loc">
                              <a class="preview" href="{s:image/image:loc}" target="_blank" rel="noopener noreferrer" aria-label="Open page image in a new tab">
                                <img src="{s:image/image:loc}" alt="{s:image/image:title}" width="58" height="44" loading="lazy" decoding="async" />
                              </a>
                            </xsl:when>
                            <xsl:otherwise><span class="empty">—</span></xsl:otherwise>
                          </xsl:choose>
                        </td>
                      </tr>
                    </xsl:for-each>
                  </tbody>
                </table>
              </div>
            </div>
            <footer>
              <span>Generated from the current public sitemap. Private and duplicate routes are not listed.</span>
              <span>Search engines continue to receive the standard XML index.</span>
            </footer>
          </div>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
