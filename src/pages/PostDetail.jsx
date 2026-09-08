import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Icons, Reveal } from '../components/ui';
import { PostCard } from '../components/cards';
import { postBySlug, POSTS } from '../data/posts';
import NotFound from './NotFound';

export default function PostDetail() {
  const { slug } = useParams();
  const post = postBySlug(slug);
  if (!post) return <NotFound />;

  const related = POSTS.filter((p) => p.slug !== slug).slice(0, 3);

  return (
    <>
      <header className="page-hero">
        <div className="page-hero__img">
          <img src={post.image} alt="" />
        </div>
        <div className="container">
          <motion.nav
            className="breadcrumb"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Link to="/">خانه</Link>
            <span className="sep">/</span>
            <Link to="/blog">وبلاگ</Link>
            <span className="sep">/</span>
            <span>{post.category}</span>
          </motion.nav>
          <motion.h1
            style={{ maxWidth: 900 }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          >
            {post.title}
          </motion.h1>
          <motion.div
            style={{ display: 'flex', gap: 22, color: 'rgba(255,255,255,.75)', fontSize: 14, flexWrap: 'wrap' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24 }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icons.clock size={16} />
              {post.readTime} مطالعه
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icons.doc size={16} />
              {post.date}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icons.users size={16} />
              واحد تحقیق و توسعه (R&D)
            </span>
          </motion.div>
        </div>
      </header>

      <section className="section">
        <div className="container">
          <Reveal className="gallery-img" style={{ maxWidth: 900, margin: '0 auto 44px' }}>
            <img src={post.image} alt={post.title} style={{ height: 400 }} />
          </Reveal>

          <article className="post-body">
            {post.body.map((block, i) => (
              <Reveal key={i} delay={0.04}>
                {block.h && <h2>{block.h}</h2>}
                {block.p && <p>{block.p}</p>}
                {block.list && (
                  <ul>
                    {block.list.map((li) => (
                      <li key={li}>{li}</li>
                    ))}
                  </ul>
                )}
              </Reveal>
            ))}

            <Reveal>
              <div className="post-callout">
                <strong>🔬 واحد تحقیق و توسعه (R&D) خمیر مایه خوزستان</strong>
                <p style={{ margin: '8px 0 0' }}>
                  مرکز پژوهشی و کنترل کیفیت شرکت خمیر مایه خوزستان، مجهز به پیشرفته‌ترین تجهیزات
                  آنالیز رئولوژیکی آرد و فعالیت زیستی مخمر، با نظارت آزمایشگاه VH برلین آلمان.
                </p>
              </div>
            </Reveal>

            <Reveal>
              <Link to="/blog" className="link-arrow">
                بازگشت به فهرست مقالات
                <Icons.arrow size={17} />
              </Link>
            </Reveal>
          </article>
        </div>
      </section>

      {related.length > 0 && (
        <section className="section section--soft">
          <div className="container">
            <Reveal className="section-head">
              <h2 className="section-title">
                مقالات <em>مرتبط</em>
              </h2>
            </Reveal>
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
