import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft } from '../components/Icon/Icon';
import styles from './Legal.module.css';

/**
 * Plain-language summary of what the app actually stores and how it behaves,
 * written against the real schema and auth code rather than boilerplate. The
 * banner at the top is deliberate: this has not been reviewed by a lawyer, and
 * says so rather than implying more authority than it has.
 */
export function Legal() {
  const navigate = useNavigate();
  const location = useLocation();

  // This page is reachable signed-out and link-shareable, so it can be the very
  // first entry in the history stack - key 'default' means there's nothing of
  // ours to go back to, and navigate(-1) would leave the app entirely.
  const goBack = () => (location.key === 'default' ? navigate('/') : navigate(-1));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={goBack} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className={styles.title}>Legal & privacy</h1>
      </div>

      <div className={styles.notice}>
        This is a plain-language summary of how Cookbook handles your data, not a
        lawyer-reviewed policy. If this app is ever opened up beyond friends and
        family, have a professional review it first.
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>What we store</h2>
        <p className={styles.text}>
          When you make an account we store your email address and display name.
          Your password is never stored — only an Argon2id hash of it, which
          can't be reversed back into your password.
        </p>
        <p className={styles.text}>Everything else is what you create in the app:</p>
        <ul className={styles.list}>
          <li>Meals you publish, cook, save, or rate</li>
          <li>Reviews and notes you leave after cooking</li>
          <li>Ingredient edits you suggest and votes you cast</li>
          <li>Your fridge and shopping list</li>
          <li>Chefs you follow</li>
          <li>Your cookbook customization — title, bio, themes, and photos</li>
        </ul>
        <p className={styles.text}>
          Photos are resized in your browser and stored directly in the database.
          They aren't sent to any outside image host.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cookies</h2>
        <p className={styles.text}>
          One cookie, <code className={styles.code}>cb_session</code>, which keeps
          you signed in for 30 days. It's HTTP-only (JavaScript can't read it),
          sent only over HTTPS in production, and holds a random token — not your
          identity or password. The server stores only a hash of that token.
        </p>
        <p className={styles.text}>
          There are no advertising, analytics, or tracking cookies, and no
          third-party trackers anywhere in the app.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Who can see your things</h2>
        <p className={styles.text}>
          Meals you publish and ingredient edits you suggest are public — edits are
          a community feature, so other people can see and vote on them.
        </p>
        <p className={styles.text}>
          Your recipes, cooking log, saved list, and fridge each have their own
          public/private toggle in Settings. Reviews are public unless you mark an
          individual one private when you write it.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Your control</h2>
        <ul className={styles.list}>
          <li>Change your email or password any time in Settings.</li>
          <li>Changing your password signs out every other device.</li>
          <li>Withdraw any ingredient edit you submitted from the ingredient's page.</li>
          <li>
            Delete your account in Settings. That removes your profile, meals,
            reviews, ratings, fridge, shopping list, follows, and sessions.
            Ingredient edits you submitted stay, since other people may have voted
            on them and they may be the current accepted value — but they're no
            longer attributed to you.
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Fair use</h2>
        <p className={styles.text}>
          Don't upload photos or text you don't have the right to share, and don't
          use the community edit feature to vandalize ingredient pages. Nutrition
          information here is general reference data, not dietary or medical
          advice — check labels yourself if you have an allergy or medical
          condition.
        </p>
        <p className={styles.text}>
          The app is provided as-is, with no guarantee of uptime or that data
          won't be lost.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Data attribution</h2>
        <p className={styles.text}>
          Nutrition data comes from the U.S. Department of Agriculture's{' '}
          <a
            className={styles.link}
            href="https://fdc.nal.usda.gov/"
            target="_blank"
            rel="noreferrer"
          >
            FoodData Central
          </a>{' '}
          (Foundation Foods dataset). As a U.S. government work it's in the public
          domain. Values are per 100&nbsp;g, and blanks mean the USDA doesn't
          report that nutrient for that food rather than that it contains none.
        </p>
      </section>
    </div>
  );
}
