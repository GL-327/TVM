/**
 * Fallback browse catalog used when live Cinemeta rails have not loaded yet.
 * TVM Stream play goes through Cinemeta + Torrentio + Real-Debrid.
 */
const TMDB = 'https://image.tmdb.org/t/p';

function art(size: 'w500' | 'w780' | 'w1280' | 'original', path: string): string {
  return `${TMDB}/${size}${path}`;
}

export interface Title {
  id: string;
  title: string;
  year: number;
  kind: 'movie' | 'series';
  synopsis: string;
  poster: string;
  backdrop: string;
  genres: readonly string[];
  rating: string;
  runtime?: string;
  seasons?: number;
  /** Hue 0-360 used only if artwork fails to load. */
  hue: number;
  /** 0-1, only set on continue-watching items. */
  progress?: number;
  playable?: boolean;
  network?: string;
  episodeLabel?: string;
  wordmark?: 'ember' | 'plain';
}

export interface AppTile {
  id: string;
  name: string;
  accent: string;
  url: string;
  wordmark?: string;
  icon?: string;
}

export const TITLES: readonly Title[] = [
  {
    id: 'dune-part-two',
    title: 'Dune: Part Two',
    year: 2024,
    kind: 'movie',
    rating: '12',
    runtime: '2h 46m',
    genres: ['Science Fiction', 'Adventure'],
    hue: 32,
    poster: art('w780', '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg'),
    backdrop: art('original', '/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg'),
    synopsis:
      'Paul Atreides unites with the Fremen to take revenge against the conspirators who destroyed his family, and to prevent a terrible future only he can foresee.',
  },
  {
    id: 'the-last-of-us',
    title: 'The Last of Us',
    year: 2023,
    kind: 'series',
    rating: '18',
    seasons: 2,
    genres: ['Drama', 'Adventure'],
    hue: 85,
    poster: art('w780', '/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg'),
    backdrop: art('original', '/lY2DhbA7Hy44fAKddr06UrXWWaQ.jpg'),
    synopsis:
      'Twenty years after a fungal outbreak collapses society, a hardened survivor is hired to smuggle a fourteen-year-old girl out of a quarantine zone.',
  },
  {
    id: 'oppenheimer',
    title: 'Oppenheimer',
    year: 2023,
    kind: 'movie',
    rating: '15',
    runtime: '3h 00m',
    genres: ['Drama', 'History'],
    hue: 20,
    poster: art('w780', '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg'),
    backdrop: art('original', '/rLb2cwF3Pazuxaj0sRXQ037tGI1.jpg'),
    synopsis:
      'The story of J. Robert Oppenheimer and the team that built the atomic bomb, and the political firestorm that followed.',
  },
  {
    id: 'the-batman',
    title: 'The Batman',
    year: 2022,
    kind: 'movie',
    rating: '15',
    runtime: '2h 56m',
    genres: ['Crime', 'Mystery'],
    hue: 210,
    poster: art('w780', '/74xTEgt7R36Fpooo50r9T25onhq.jpg'),
    backdrop: art('original', '/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg'),
    synopsis:
      'In his second year of fighting crime, Batman uncovers corruption in Gotham City that connects to his own family while facing a serial killer known as the Riddler.',
  },
  {
    id: 'stranger-things',
    title: 'Stranger Things',
    year: 2016,
    kind: 'series',
    rating: '15',
    seasons: 5,
    genres: ['Science Fiction', 'Mystery'],
    hue: 350,
    poster: art('w780', '/uKYUR8GPkKRCksczYDJb3pwZauo.jpg'),
    backdrop: art('original', '/56v2KjBlU4XaOv9rVYEQypROD7P.jpg'),
    synopsis:
      'When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces, and one strange little girl.',
  },
  {
    id: 'the-boys',
    title: 'The Boys',
    year: 2019,
    kind: 'series',
    rating: '18',
    seasons: 4,
    genres: ['Action', 'Comedy'],
    hue: 8,
    poster: art('w780', '/2zmTngn1tYC1AvfnrFLhxeD82hz.jpg'),
    backdrop: art('original', '/n6vVs6z8obNbExdD3QHTr4Utu1Z.jpg'),
    synopsis:
      'A group of vigilantes set out to take down corrupt superheroes who abuse their superpowers.',
  },
  {
    id: 'spider-verse',
    title: 'Spider-Man: Across the Spider-Verse',
    year: 2023,
    kind: 'movie',
    rating: 'PG',
    runtime: '2h 20m',
    genres: ['Animation', 'Action'],
    hue: 280,
    poster: art('w780', '/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg'),
    backdrop: art('original', '/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg'),
    synopsis:
      'Miles Morales catapults across the Multiverse, where he meets a team of Spider-People charged with protecting its very existence.',
  },
  {
    id: 'interstellar',
    title: 'Interstellar',
    year: 2014,
    kind: 'movie',
    rating: '12',
    runtime: '2h 49m',
    genres: ['Science Fiction', 'Drama'],
    hue: 200,
    poster: art('w780', '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg'),
    backdrop: art('original', '/5XNQBqnBwPA9yT0jZ0p3s8bbLh0.jpg'),
    synopsis:
      'A team of explorers travel through a wormhole in space in an attempt to ensure humanity’s survival.',
  },
  {
    id: 'the-dark-knight',
    title: 'The Dark Knight',
    year: 2008,
    kind: 'movie',
    rating: '12',
    runtime: '2h 32m',
    genres: ['Action', 'Crime'],
    hue: 220,
    poster: art('w780', '/qJ2tW6WMUDux911r6m7haRef0WH.jpg'),
    backdrop: art('original', '/cfT29Im5VDvjE0RpyKOSdCKZal7.jpg'),
    synopsis:
      'Batman raises the stakes in his war on crime. With the help of Lt. Jim Gordon and District Attorney Harvey Dent, he sets out to dismantle the remaining criminal organizations that plague the streets.',
  },
  {
    id: 'inception',
    title: 'Inception',
    year: 2010,
    kind: 'movie',
    rating: '12',
    runtime: '2h 28m',
    genres: ['Science Fiction', 'Action'],
    hue: 200,
    poster: art('w780', '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg'),
    backdrop: art('original', '/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg'),
    synopsis:
      'A thief who steals corporate secrets through dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.',
  },
  {
    id: 'no-way-home',
    title: 'Spider-Man: No Way Home',
    year: 2021,
    kind: 'movie',
    rating: '12',
    runtime: '2h 28m',
    genres: ['Action', 'Adventure'],
    hue: 350,
    poster: art('w780', '/1g0dhYtq4irTY1GPXvft6k4YLjm.jpg'),
    backdrop: art('original', '/14QbnygCuTO0vl7CAFmPf1fgZfV.jpg'),
    synopsis:
      'Peter Parker’s secret identity is revealed, and he asks Doctor Strange for help. When a spell goes wrong, dangerous foes from other worlds start to appear.',
  },
  {
    id: 'infinity-war',
    title: 'Avengers: Infinity War',
    year: 2018,
    kind: 'movie',
    rating: '12',
    runtime: '2h 29m',
    genres: ['Action', 'Adventure'],
    hue: 15,
    poster: art('w780', '/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg'),
    backdrop: art('original', '/mDfJG3LC3Dqb67AZ52x3Z0jU0uB.jpg'),
    synopsis:
      'The Avengers and their allies must be willing to sacrifice all in an attempt to defeat the powerful Thanos before his blitz of devastation and ruin puts an end to the universe.',
  },
  {
    id: 'endgame',
    title: 'Avengers: Endgame',
    year: 2019,
    kind: 'movie',
    rating: '12',
    runtime: '3h 01m',
    genres: ['Action', 'Adventure'],
    hue: 25,
    poster: art('w780', '/or06FN3Dka5tukK1e9sl16pB3iy.jpg'),
    backdrop: art('original', '/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg'),
    synopsis:
      'After the devastating events of Infinity War, the Avengers assemble once more in order to reverse Thanos’ actions and restore balance to the universe.',
  },
  {
    id: 'john-wick-4',
    title: 'John Wick: Chapter 4',
    year: 2023,
    kind: 'movie',
    rating: '15',
    runtime: '2h 49m',
    genres: ['Action', 'Thriller'],
    hue: 10,
    poster: art('w780', '/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg'),
    backdrop: art('original', '/7I6VUdPj6tQECNHdviJkUHD2u89.jpg'),
    synopsis:
      'John Wick uncovers a path to defeating The High Table. But before he can earn his freedom, he must face a new enemy with powerful alliances across the globe.',
  },
  {
    id: 'star-wars',
    title: 'Star Wars',
    year: 1977,
    kind: 'movie',
    rating: 'U',
    runtime: '2h 01m',
    genres: ['Adventure', 'Science Fiction'],
    hue: 45,
    poster: art('w780', '/6FfCtAuVAW8XJjZ7eWeLibRLWTw.jpg'),
    backdrop: art('original', '/yUiXA68FfQeA8cRBhd0Ao0jIRZt.jpg'),
    synopsis:
      'Luke Skywalker joins forces with a Jedi Knight, a cocky pilot, a Wookiee and two droids to save the galaxy from the Empire’s world-destroying battle station.',
  },
  {
    id: 'the-godfather',
    title: 'The Godfather',
    year: 1972,
    kind: 'movie',
    rating: '15',
    runtime: '2h 55m',
    genres: ['Crime', 'Drama'],
    hue: 28,
    poster: art('w780', '/3bhkrj58Vtu7enYsRolD1fZdja1.jpg'),
    backdrop: art('original', '/tSPT36ZKlP2WVHJLM4cQPLSzv3b.jpg'),
    synopsis:
      'The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant son.',
  },
  {
    id: 'shawshank',
    title: 'The Shawshank Redemption',
    year: 1994,
    kind: 'movie',
    rating: '15',
    runtime: '2h 22m',
    genres: ['Drama'],
    hue: 18,
    poster: art('w780', '/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg'),
    backdrop: art('original', '/zfbjgQE1uSd9wiPTX4VzsLi0rGG.jpg'),
    synopsis:
      'Two imprisoned men bond over a number of years, finding solace and eventual redemption through acts of common decency.',
  },
  {
    id: 'pulp-fiction',
    title: 'Pulp Fiction',
    year: 1994,
    kind: 'movie',
    rating: '18',
    runtime: '2h 34m',
    genres: ['Crime', 'Thriller'],
    hue: 40,
    poster: art('w780', '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg'),
    backdrop: art('original', '/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg'),
    synopsis:
      'The lives of two mob hitmen, a boxer, a gangster and his wife, and a pair of diner bandits intertwine in four tales of violence and redemption.',
  },
  {
    id: 'fight-club',
    title: 'Fight Club',
    year: 1999,
    kind: 'movie',
    rating: '18',
    runtime: '2h 19m',
    genres: ['Drama'],
    hue: 15,
    poster: art('w780', '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg'),
    backdrop: art('original', '/c6OLXfKAk5BKeR6broC8pYiCquX.jpg'),
    synopsis:
      'An insomniac office worker and a devil-may-care soap maker form an underground fight club that evolves into something much more.',
  },
  {
    id: 'titanic',
    title: 'Titanic',
    year: 1997,
    kind: 'movie',
    rating: '12',
    runtime: '3h 14m',
    genres: ['Drama', 'Romance'],
    hue: 200,
    poster: art('w780', '/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg'),
    backdrop: art('original', '/xnHVX37XZEp33hhCbYlQFq7ux1J.jpg'),
    synopsis:
      'A seventeen-year-old aristocrat falls in love with a kind but poor artist aboard the luxurious, ill-fated R.M.S. Titanic.',
  },
  {
    id: 'game-of-thrones',
    title: 'Game of Thrones',
    year: 2011,
    kind: 'series',
    rating: '18',
    seasons: 8,
    genres: ['Drama', 'Fantasy'],
    hue: 25,
    poster: art('w780', '/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg'),
    backdrop: art('original', '/2OMB0ynKlyIenMJWI2Dy9IWT4c.jpg'),
    synopsis:
      'Nine noble families wage war against each other in order to gain control over the mythical land of Westeros.',
  },
  {
    id: 'breaking-bad',
    title: 'Breaking Bad',
    year: 2008,
    kind: 'series',
    rating: '18',
    seasons: 5,
    genres: ['Crime', 'Drama'],
    hue: 140,
    poster: art('w780', '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg'),
    backdrop: art('original', '/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg'),
    synopsis:
      'A high school chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine with a former student.',
  },
  {
    id: 'wednesday',
    title: 'Wednesday',
    year: 2022,
    kind: 'series',
    rating: '12',
    seasons: 2,
    genres: ['Comedy', 'Fantasy'],
    hue: 260,
    poster: art('w780', '/9PFonBhy4cQy7Jz20NpMygczOkv.jpg'),
    backdrop: art('original', '/iHSwvRVsRyxpX7FE7GbviaDvgGZ.jpg'),
    synopsis:
      'A coming-of-age story following Wednesday Addams at Nevermore Academy, where she attempts to master her emerging psychic ability and solve a monstrous mystery.',
  },
  {
    id: 'house-of-the-dragon',
    title: 'House of the Dragon',
    year: 2022,
    kind: 'series',
    rating: '18',
    seasons: 2,
    genres: ['Drama', 'Fantasy'],
    hue: 15,
    poster: art('w780', '/7QMsOTMUswlwxJP0rTTZfmz2tX2.jpg'),
    backdrop: art('original', '/577eXC8wFQT0eUrJcgznSiFPRmk.jpg'),
    synopsis:
      'The Targaryen dynasty is at the absolute apex of its power. Most empires crumble from such heights. Their slow fall begins when King Viserys names his daughter Rhaenyra heir to the Iron Throne.',
  },
  {
    id: 'severance',
    title: 'Severance',
    year: 2022,
    kind: 'series',
    rating: '15',
    seasons: 2,
    genres: ['Mystery', 'Drama'],
    hue: 200,
    poster: art('w780', '/kEl2t3OhXc3Zb9FBh1AuYzRTgZp.jpg'),
    backdrop: art('original', '/q3jHCb4dMfYF6ojikKuHd6LscxC.jpg'),
    synopsis:
      'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives. When a mysterious colleague appears outside of work, it begins a journey to discover the truth.',
  },
  {
    id: 'silo',
    title: 'Silo',
    year: 2023,
    kind: 'series',
    rating: '15',
    seasons: 2,
    genres: ['Science Fiction', 'Drama'],
    hue: 40,
    poster: art('w780', '/r2QXomqKjkKHVtYGGtkf2l2Y7go.jpg'),
    backdrop: art('original', '/uTWhbLc7Bj4qNSdW3ZvZKL8cOHv.jpg'),
    synopsis:
      'In a ruined and toxic future, thousands live in a giant silo that plunges hundreds of stories into the ground. The last ten thousand people on Earth. They don’t know it.',
  },
  {
    id: 'the-bear',
    title: 'The Bear',
    year: 2022,
    kind: 'series',
    rating: '15',
    seasons: 3,
    genres: ['Drama', 'Comedy'],
    hue: 12,
    poster: art('w780', '/i6sJI3O1874FBdDtM0jn6fpPE0x.jpg'),
    backdrop: art('original', '/aJtG4txtmiRHwAAqENQHZvBs6kY.jpg'),
    synopsis:
      'A young chef from the fine-dining world returns to Chicago to run his family’s sandwich shop after a heartbreaking death.',
  },
  {
    id: 'squid-game',
    title: 'Squid Game',
    year: 2021,
    kind: 'series',
    rating: '18',
    seasons: 2,
    genres: ['Thriller', 'Drama'],
    hue: 345,
    poster: art('w780', '/dDlEmu3EZ0Pgg93K2SVNLCjCSvE.jpg'),
    backdrop: art('original', '/2meX1nMdScFOoV4370rqHWKmXhY.jpg'),
    synopsis:
      'Hundreds of cash-strapped players accept a strange invitation to compete in children’s games. Inside, a tempting prize awaits — with deadly high stakes.',
  },
  {
    id: 'the-mandalorian',
    title: 'The Mandalorian',
    year: 2019,
    kind: 'series',
    rating: '12',
    seasons: 3,
    genres: ['Science Fiction', 'Adventure'],
    hue: 30,
    poster: art('w780', '/x4b89IkzxfGnA26coS5nRpkEzPo.jpg'),
    backdrop: art('original', '/9zcbqSxdsRMZWHYtyCd1nXPr2xq.jpg'),
    synopsis:
      'After the fall of the Empire, a lone bounty hunter makes his way through the outer reaches of the galaxy, far from the authority of the New Republic.',
  },
  {
    id: 'the-witcher',
    title: 'The Witcher',
    year: 2019,
    kind: 'series',
    rating: '18',
    seasons: 3,
    genres: ['Fantasy', 'Adventure'],
    hue: 50,
    poster: art('w780', '/cZ0d3rtvXPVvuiX22sP79K3Hmjz.jpg'),
    backdrop: art('original', '/foGkPxpw9h8zln81j63mix5B7m8.jpg'),
    synopsis:
      'Geralt of Rivia, a mutated monster-hunter for hire, journeys toward his destiny in a turbulent world where people often prove more wicked than beasts.',
  },
  {
    id: 'the-devil-wears-prada',
    title: 'The Devil Wears Prada',
    year: 2006,
    kind: 'movie',
    rating: 'PG-13',
    runtime: '1h 49m',
    genres: ['Comedy', 'Drama'],
    hue: 330,
    poster: art('w780', '/8912heDRnpxR5nGUosFYnKbpTyv.jpg'),
    backdrop: art('original', '/wEWH21Cfwj7pMVoKS4pG3FWVQYl.jpg'),
    synopsis:
      'A smart but sensible first-year college graduate lands a job as an assistant to Miranda Priestly, the demanding editor-in-chief of a high-fashion magazine.',
  },
  {
    id: 'invincible',
    title: 'Invincible',
    year: 2021,
    kind: 'series',
    rating: '18',
    seasons: 3,
    genres: ['Animation', 'Action'],
    hue: 12,
    poster: art('w780', '/dMOpdkrDC5dQxgNwewpvL6qjPZ5.jpg'),
    backdrop: art('original', '/7bWxAsNPv9EXHvwSCxTb3sBQGGS.jpg'),
    synopsis:
      'Mark Grayson is a normal teenager except for the fact that his father is the most powerful superhero on the planet.',
  },
  {
    id: 'avatar',
    title: 'Avatar',
    year: 2009,
    kind: 'movie',
    rating: '12',
    runtime: '2h 42m',
    genres: ['Science Fiction', 'Adventure'],
    hue: 190,
    poster: art('w780', '/jRXYjXNq0Cs2TcJjLoIwNq8a0sd.jpg'),
    backdrop: art('original', '/8Y43POKjjKDGI9MH89NW0NAzzp8.jpg'),
    synopsis:
      'A paraplegic Marine dispatched to the moon Pandora becomes torn between following his orders and protecting the world he feels is his home.',
  },
  {
    id: 'dexter',
    title: 'Dexter',
    year: 2006,
    kind: 'series',
    rating: '18',
    seasons: 8,
    genres: ['Crime', 'Drama'],
    hue: 8,
    poster: art('w780', '/q8dWfc4Jw65f6OhJdCeFU6SfQtn.jpg'),
    backdrop: art('original', '/y7T1JGKoxpei3rRoA8C6QZxQNyD.jpg'),
    synopsis:
      'A Miami-metro blood-spatter expert by day, Dexter Morgan is a serial killer who only targets other killers.',
  },
  {
    id: 'supernatural',
    title: 'Supernatural',
    year: 2005,
    kind: 'series',
    rating: '15',
    seasons: 15,
    genres: ['Drama', 'Fantasy'],
    hue: 30,
    poster: art('w780', '/KoYWXbnYuS3b0GyQPkbuexlVK9.jpg'),
    backdrop: art('original', '/nVRyd8hlg0ZLxBn9Ra16g5A8bN3.jpg'),
    synopsis:
      'Two brothers follow their father\'s footsteps as hunters, fighting evil supernatural beings of many kinds.',
  },
  {
    id: 'outer-range',
    title: 'Outer Range',
    year: 2022,
    kind: 'series',
    rating: '15',
    seasons: 2,
    genres: ['Drama', 'Mystery'],
    hue: 28,
    wordmark: 'ember',
    network: 'prime video',
    poster: art('w780', '/9leGmIDamsWJELYz0pZkr2EXUFf.jpg'),
    backdrop: art('original', '/wI4aGtreUx7vFtZGcyiFoOX3qf3.jpg'),
    synopsis:
      'A rancher fighting for his land and family stumbles upon an unfathomable mystery at the edge of Wyoming’s wilderness.',
  },
  {
    id: 'the-wilds',
    title: 'The Wilds',
    year: 2020,
    kind: 'series',
    rating: '15',
    seasons: 2,
    genres: ['Drama', 'Mystery'],
    hue: 160,
    network: 'prime video',
    poster: art('w780', '/gHBtyMdHbWoM3tpM8VZymer8HfF.jpg'),
    backdrop: art('original', '/7SSO2wXsuOOVnB6oeWbuIDynrE2.jpg'),
    synopsis:
      'A group of teenage girls from different backgrounds must fight for survival after a plane crash strands them on a deserted island.',
  },
  {
    id: 'outlander',
    title: 'Outlander',
    year: 2014,
    kind: 'series',
    rating: '18',
    seasons: 7,
    genres: ['Drama', 'Romance'],
    hue: 15,
    network: 'Starz',
    poster: art('w780', '/oftZNfyTVNU7IfOqoGLoT8MGvNs.jpg'),
    backdrop: art('original', '/nf3Vlxm3C9U1aKUUQHmKFZmxPSc.jpg'),
    synopsis:
      'Claire Randall is sent back in time from 1945 to 1743 Scotland, where she becomes entangled in the Jacobite risings.',
  },
  {
    id: 'yellowjackets',
    title: 'Yellowjackets',
    year: 2021,
    kind: 'series',
    rating: '18',
    seasons: 3,
    genres: ['Drama', 'Mystery'],
    hue: 8,
    network: 'Showtime',
    poster: art('w780', '/kAvJ2oe1qIGorPDP9CV0TGOgVss.jpg'),
    backdrop: art('original', '/q6ntQhnMSNc4if7mlcatRDti1EE.jpg'),
    synopsis:
      'A high-school girls’ soccer team survives a plane crash, and the present-day adults live with what they did to stay alive.',
  },
  {
    id: 'baywatch',
    title: 'Baywatch',
    year: 2017,
    kind: 'movie',
    rating: '12',
    runtime: '1h 56m',
    genres: ['Comedy', 'Action'],
    hue: 200,
    network: 'Pluto TV',
    poster: art('w780', '/6HE4xd8zloDqmjMZuhUCCw2UcY1.jpg'),
    backdrop: art('original', '/6QmX2BDVr1hIOIPHqnxvp1C1ZZp.jpg'),
    synopsis:
      'Devoted lifeguard Mitch Buchannon butts heads with a brash new recruit as they uncover a criminal plot on the beach.',
  },
  {
    id: 'reacher',
    title: 'Reacher',
    year: 2022,
    kind: 'series',
    rating: '15',
    seasons: 3,
    genres: ['Action', 'Crime'],
    hue: 20,
    network: 'prime video',
    poster: art('w780', '/f1VCQIG2iCyOookdgOzwtUpwWC0.jpg'),
    backdrop: art('original', '/pF0qkRsrHkdYadPWY9AMeFZfcwk.jpg'),
    synopsis:
      'Jack Reacher, a veteran military policeman, travels the country and takes the law into his own hands when he sees injustice.',
  },
  {
    id: 'bel-air',
    title: 'Bel-Air',
    year: 2022,
    kind: 'series',
    rating: '15',
    seasons: 3,
    genres: ['Drama'],
    hue: 45,
    network: 'Peacock',
    poster: art('w780', '/6oFjg5ToUCNBnkBlhSFtYTIlmZ9.jpg'),
    backdrop: art('original', '/3l29PW0pCmpICnhUfIJJac4FQzi.jpg'),
    synopsis:
      'A dramatic reimagining of The Fresh Prince of Bel-Air, following Will’s move from West Philadelphia to his aunt and uncle’s estate.',
  },
  {
    id: 'ten-truths-about-love',
    title: '10 Truths About Love',
    year: 2022,
    kind: 'movie',
    rating: 'PG',
    runtime: '1h 30m',
    genres: ['Romance', 'Comedy'],
    hue: 330,
    network: 'Tubi',
    poster: art('w780', '/iHfYFteL7lRjhvZtpL1DsU4dkeU.jpg'),
    backdrop: art('original', '/iHfYFteL7lRjhvZtpL1DsU4dkeU.jpg'),
    synopsis:
      'A woman who has given up on dating is pushed back into the world of love by her well-meaning friends.',
  },
  {
    id: 'smackdown',
    title: 'Friday Night SmackDown',
    year: 1999,
    kind: 'series',
    rating: '12',
    seasons: 26,
    genres: ['Sports'],
    hue: 210,
    network: 'Fox',
    poster: art('w780', '/iYUtjx1EN4SVTgxd2TB4cZTGSQb.jpg'),
    backdrop: art('original', '/qLUtXJAylnWFwD8gQxKxbyctpYd.jpg'),
    synopsis:
      'WWE’s Friday night brand showcases championship matches, rivalries, and weekly wrestling storylines.',
  },
  {
    id: 'girls5eva',
    title: 'Girls5eva',
    year: 2021,
    kind: 'series',
    rating: '15',
    seasons: 3,
    genres: ['Comedy', 'Music'],
    hue: 300,
    network: 'Peacock',
    poster: art('w780', '/1HWkAfvOUs9W2rEozxGntcE8BYk.jpg'),
    backdrop: art('original', '/eiLeB4GfTpvFaDsjBbtIaMIXHIt.jpg'),
    synopsis:
      'A one-hit-wonder girl group from the early 2000s reunites after their song is sampled, chasing a second chance at fame.',
  },
  {
    id: 'star-trek-discovery',
    title: 'Star Trek: Discovery',
    year: 2017,
    kind: 'series',
    rating: '12',
    seasons: 5,
    genres: ['Science Fiction', 'Adventure'],
    hue: 210,
    network: 'Paramount+',
    poster: art('w780', '/xwpOHgym48Ftz7fbJq5te5xoiwu.jpg'),
    backdrop: art('original', '/ePr0k72sypMpZYubz6w34dcW68Y.jpg'),
    synopsis:
      'Ten years before Kirk, the crew of the U.S.S. Discovery explores new worlds and fights to keep the Federation alive.',
  },
];

export const HOME_ROW_ONE_IDS = ['the-wilds', 'outlander', 'yellowjackets', 'baywatch', 'reacher'] as const;
export const HOME_ROW_TWO_IDS = ['bel-air', 'ten-truths-about-love', 'smackdown', 'girls5eva', 'star-trek-discovery'] as const;
export const HERO_SLIDE_IDS = ['outer-range', 'reacher', 'yellowjackets', 'the-wilds'] as const;

export const TVM_STREAM: AppTile = {
  id: 'tvm-stream',
  name: 'TVM Stream',
  accent: '#5b3dff',
  url: 'internal:library',
  wordmark: 'TVM',
  icon: '/apps/tvm.svg',
};

export const APPS: readonly AppTile[] = [
  { id: 'netflix', name: 'Netflix', accent: '#e50914', url: 'internal:mock', wordmark: 'NETFLIX', icon: '/apps/netflix.svg' },
  { id: 'prime', name: 'Prime Video', accent: '#00a8e1', url: 'internal:mock', wordmark: 'prime video', icon: '/apps/marks/prime.svg' },
  { id: 'max', name: 'HBO Max', accent: '#002be7', url: 'internal:mock', wordmark: 'max', icon: '/apps/marks/max.svg' },
  { id: 'appletv', name: 'Apple TV', accent: '#141414', url: 'internal:mock', wordmark: 'tv+', icon: '/apps/marks/appletv.svg' },
  { id: 'disney', name: 'Disney+', accent: '#113c8c', url: 'internal:mock', wordmark: 'disney+', icon: '/apps/marks/disney.svg' },
  { id: 'hulu', name: 'Hulu', accent: '#1ce783', url: 'internal:mock', wordmark: 'hulu', icon: '/apps/marks/hulu.svg' },
  { id: 'peacock', name: 'Peacock', accent: '#000000', url: 'internal:mock', wordmark: 'peacock', icon: '/apps/marks/peacock.svg' },
];

export const MORE_APPS: readonly AppTile[] = [
  { id: 'youtube', name: 'YouTube', accent: '#ffffff', url: 'https://www.youtube.com/tv', wordmark: 'YouTube', icon: '/apps/youtube.svg' },
  { id: 'freevee', name: 'Freevee', accent: '#111111', url: 'https://www.amazon.com/gp/video/storefront/freevee', wordmark: 'freevee', icon: '/apps/marks/freevee.svg' },
  { id: 'iplayer', name: 'BBC iPlayer', accent: '#ffffff', url: 'https://www.bbc.co.uk/iplayer', wordmark: 'iPlayer', icon: '/apps/marks/iplayer.svg' },
  { id: 'paramount', name: 'Paramount+', accent: '#ffffff', url: 'https://www.paramountplus.com/', wordmark: 'paramount+', icon: '/apps/marks/paramount.svg' },
  { id: 'tubi', name: 'Tubi', accent: '#fa382f', url: 'https://tubitv.com/', wordmark: 'tubi', icon: '/apps/marks/tubi.svg' },
  { id: 'pluto', name: 'Pluto TV', accent: '#000000', url: 'https://pluto.tv/', wordmark: 'Pluto TV', icon: '/apps/marks/pluto.svg' },
  { id: 'starz', name: 'Starz', accent: '#ffffff', url: 'https://www.starz.com/', wordmark: 'STARZ', icon: '/apps/marks/starz.svg' },
  { id: 'fox', name: 'Fox', accent: '#ffffff', url: 'https://www.fox.com/', wordmark: 'FOX', icon: '/apps/marks/fox.svg' },
];

export function titleById(id: string): Title | undefined {
  return TITLES.find((item) => item.id === id);
}

export function titlesByIds(ids: readonly string[]): Title[] {
  return ids
    .map((id) => titleById(id))
    .filter((item): item is Title => item !== undefined);
}

export function featuredTitle(): Title {
  return TITLES[0] as Title;
}

export function movies(): readonly Title[] {
  return TITLES.filter((item) => item.kind === 'movie');
}

export function series(): readonly Title[] {
  return TITLES.filter((item) => item.kind === 'series');
}

export function titlesByGenre(genre: string): Title[] {
  const needle = genre.toLowerCase();
  return TITLES.filter((item) => item.genres.some((entry) => entry.toLowerCase() === needle));
}

export function takeUnused(source: readonly Title[], used: Set<string>, limit: number): Title[] {
  const out: Title[] = [];
  for (const title of source) {
    if (used.has(title.id) || used.has(title.title)) continue;
    used.add(title.id);
    used.add(title.title);
    out.push(title);
    if (out.length >= limit) break;
  }
  return out;
}

export function recentTitles(): Title[] {
  return TITLES.filter((item) => item.year >= 2021).slice().sort((a, b) => b.year - a.year);
}

export function trendingTitles(): Title[] {
  return TITLES.filter((_, index) => index % 2 === 0).slice(0, 16);
}

export function awardTitles(): Title[] {
  return titlesByIds([
    'shawshank',
    'the-godfather',
    'the-dark-knight',
    'oppenheimer',
    'inception',
    'interstellar',
    'dune-part-two',
    'the-last-of-us',
  ]);
}

export function formatMeta(title: Title): string {
  const kind = title.kind === 'series' ? (title.seasons === 1 ? '1 season' : `${title.seasons ?? ''} seasons`) : title.runtime;
  return [title.year, title.genres[0], kind].filter(Boolean).join('  ·  ');
}
