/**
 * PostCSS runs ONLY over CSS that enters the Next.js pipeline (i.e. the
 * imported `app/wallet.css`). The hero's stylesheets are inline <style> blocks
 * injected via dangerouslySetInnerHTML and static files under public/assets —
 * none of those pass through PostCSS, so the hero is unaffected by Tailwind.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
