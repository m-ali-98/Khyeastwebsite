import { Link } from 'react-router-dom';
import { Icons, Reveal, PageHero } from '../components/ui';
import { PostCard } from '../components/cards';
import { useContent } from '../content/ContentContext';
import { imgProps, SIZES } from '../lib/img';

export default function Blog() {
  const { t, m, posts } = useContent();
  const [featuredPost, ...rest] = posts;

  return (
    <>
      <PageHero title={t('blog.hero.title')} sub={t('blog.hero.sub')} image={m('blog.hero.img')} />

      <section className="section">
        <div className="container section-stack">
          {featuredPost && (
            <Reveal>
              <Link to={`/blog/${featuredPost.slug}`} className="card featured-post">
                <div className="featured-post__media">
                  <img {...imgProps(featuredPost.image, SIZES.full)} alt={featuredPost.title} loading="lazy" />
                </div>
                <div className="featured-post__body">
                  <span className="overline">
                    {t('blog.featured')} · {featuredPost.category}
                  </span>
                  <h2 className="featured-post__title">{featuredPost.title}</h2>
                  <p className="featured-post__excerpt">{featuredPost.excerpt}</p>
                  <div className="featured-post__meta">
                    <span>
                      <Icons.clock size={15} />
                      {featuredPost.readTime} {t('blog.readMinutes')}
                    </span>
                    <span>{featuredPost.date}</span>
                  </div>
                  <span className="link-arrow">
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
