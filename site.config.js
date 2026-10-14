'use strict';

// Everything site-wide lives here. Edit freely; the dev server picks up changes.
module.exports = {
  title: 'Evolution of Existence',
  tagline: 'Mind, body, spirit. A life in progress.',
  description:
    "I'm Adam. This is where I work out what's real, what matters, and what I'm made of: one person's spiritual, physical, and intellectual journey, written down as it happens.",
  url: 'https://evolutionofexistence.com',
  author: 'Adam',
  language: 'en',

  // The three threads the whole site hangs on. Tag a post `mind`, `body` or
  // `spirit` and it shows up on that thread's page (/mind/, /body/, /spirit/).
  // The intro text for each page lives in content/pages/<slug>.md.
  pillars: [
    {
      slug: 'mind',
      title: 'Mind',
      blurb: 'The intellectual journey. How everything works, why it works that way, and the need to know.',
      accent: '#8f7dff',
    },
    {
      slug: 'body',
      title: 'Body',
      blurb: 'The fitness journey. Training, food, sleep, and what the body teaches the rest of me.',
      accent: '#3fd9c3',
    },
    {
      slug: 'spirit',
      title: 'Spirit',
      blurb: 'The spiritual journey. What is real, what experience is, and what actually matters.',
      accent: '#f2b65a',
    },
  ],

  // Header navigation. Hrefs point at pages in content/pages/ (slug = filename).
  nav: [
    { label: 'Mind', href: '/mind/' },
    { label: 'Body', href: '/body/' },
    { label: 'Spirit', href: '/spirit/' },
    { label: 'Blog', href: '/blog/' },
    { label: 'Thoughts', href: '/thoughts/' },
    { label: 'Explore', href: '/explore/' },
    { label: 'Journey', href: '/journey/' },
    { label: 'About', href: '/about/' },
  ],

  // The Explore page: the graph of linked entries and the word cloud.
  explore: {
    maxWords: 100,      // how many words the cloud shows
    minDocs: 1,         // only show words that appear in at least this many entries
    stopwords: [],      // extra words to leave out, e.g. ['adam', 'blog']
    wordsFrom: 'posts', // 'posts' or 'all' (posts plus pages)
  },

  // Buttons under the big title on the home page.
  heroLinks: [
    { label: 'Read the blog', href: '/blog/', primary: true },
    { label: 'Follow the journey', href: '/journey/' },
  ],

  // Shown in the footer next to the RSS link. For example:
  // { label: 'GitHub', href: 'https://github.com/yourname' },
  links: [{ label: 'Now', href: '/now/' }],

  // How many posts and thoughts the home page shows.
  recentPosts: 5,
  recentThoughts: 3,
  thoughtsOnPage: 50, // /thoughts/ shows this many; older ones live on the month pages

  // The "while writing" line on posts: time, place, weather, what was playing.
  // The studio fills these in; see lib/context.js for the frontmatter keys.
  showMoon: true,      // add the moon phase, computed from the post date
  units: 'imperial',   // 'imperial' (°F, mph) or 'metric' (°C, km/h) for fetched weather
};
