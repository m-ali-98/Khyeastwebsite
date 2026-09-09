import { Link } from 'react-router-dom';
import { Icons, Reveal, PageHero } from '../components/ui';
import { PostCard } from '../components/cards';
import { useContent } from '../content/ContentContext';

export default function Blog() {
  const { t, m, posts } = useContent();
  const [featuredPost, ...rest] = posts;

  return (
    <>
      <PageHero title={t('blog.hero.title')} sub={t('blog.hero.sub')} image={m('blog.hero.img')} />

      <section className="section">
        <div className="container">
          {featuredPost && (
            <Reveal>
              <Link to={`/blog/${featuredPost.slug}`} className="card featured-post" style={{ overflow: 'hidden', marginBottom: 44 }}>
                <div style={{ position: 'relative', minHeight: 320 }}>
                  <img
                    src={featuredPost.image}
                    alt={featuredPost.title}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                </div>
                <div style={{ padding: '40px 40px' }}>
                  <span className="overline">
                    {t('blog.featured')} · {featuredPost.category}
                  </span>
                  <h2 style={{ fontSize: 'clamp(20px, 2.6vw, 30px)', fontWeight: 800, lineHeight: 1.8, margin: '6px 0 12px' }}>
                    {featuredPost.title}
                  </h2>
                  <p style={{ color: 'var(--muted)' }}>{featuredPost.excerpt}</p>
                  <div style={{ display: 'flex', gap: 18, color: 'var(--muted)', fontSize: 13.5, marginTop: 18 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icons.clock size={15} />
                      {featuredPost.readTime} {t('blog.readMinutes')}
                    </span>
                    <span>{featuredPost.date}</span>
                  </div>
                  <span className="link-arrow" style={{ marginTop: 22, display: 'inline-flex' }}>
                    {t('blog.readMore')}
                    <Icons.arrow size={17} />
                  </span>
                </div>
              </Link>
            </Reveal>
          )}

          <div className="posts-grid">
            {rest.map((p, i) => (
              <PostCard key={p.slug} post={p} index={i} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
