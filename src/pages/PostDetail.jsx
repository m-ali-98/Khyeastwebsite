import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { m as mo } from 'framer-motion';
import { Icons, Reveal, SectionHead, hl } from '../components/ui';
import { PostCard } from '../components/cards';
import { useContent } from '../content/ContentContext';
import { sanitizeHtml } from '../content/sanitize';
import NotFound from './NotFound';
import { imgProps, SIZES } from '../lib/img';

export default function PostDetail() {
  const { slug } = useParams();
  const { t, posts } = useContent();
  const post = posts.find((p) => p.slug === slug);
  const safeBody = useMemo(() => (post ? sanitizeHtml(post.body) : ''), [post]);

  if (!post) return <NotFound />;
  const related = posts.filter((p) => p.slug !== slug).slice(0, 3);

  return (
    <>
      <header className="page-hero">
        <div className="page-hero__img">
          <img {...imgProps(post.image, SIZES.full)} alt="" loading="eager" fetchPriority="high" />
        </div>
        <div className="container">
          <mo.nav
            className="breadcrumb"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Link to="/">{t('nav.breadcrumb.home')}</Link>
            <span className="sep">/</span>
            <Link to="/blog">{t('nav.blog')}</Link>
            <span className="sep">/</span>
            <span>{post.category}</span>
          </mo.nav>
          <mo.h1
            style={{ maxWidth: 900 }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          >
            {post.title}
          </mo.h1>
          <mo.div
            style={{ display: 'flex', gap: 22, color: 'rgba(255,255,255,.75)', fontSize: 14, flexWrap: 'wrap' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24 }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icons.clock size={16} />
              {post.readTime} {t('blog.readMinutes')}
            </span>
            <time dateTime={post.publishedAt || undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icons.doc size={16} />
              {post.date}
            </time>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icons.users size={16} />
              {t('blog.meta.author')}
            </span>
          </mo.div>
        </div>
      </header>

      <section className="section">
        <div className="container">
          <Reveal className="gallery-img post-hero-image">
            <img {...imgProps(post.image, SIZES.full)} alt={post.title} style={{ height: 400 }} loading="lazy" />
          </Reveal>

          <article className="post-body">
            <div dangerouslySetInnerHTML={{ __html: safeBody }} />

            <Reveal>
              <div className="post-callout">
                <strong>
                  <Icons.flask size={18} />
                  {t('blog.callout.title')}
                </strong>
                <p style={{ margin: '8px 0 0' }}>{t('blog.callout.text')}</p>
              </div>
            </Reveal>

            <Reveal>
              <Link to="/blog" className="link-arrow">
                {t('blog.back')}
                <Icons.arrow size={17} />
              </Link>
            </Reveal>
          </article>
        </div>
      </section>

      {related.length > 0 && (
        <section className="section section--soft">
          <div className="container">
            <SectionHead title={hl(t('blog.related'))} align="start" />
            <div className="posts-grid">
              {related.map((p, i) => (
                <PostCard key={p.slug} post={p} index={i} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
