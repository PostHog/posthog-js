import { useEffect, useState, useRef } from 'react'
import Head from 'next/head'

const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

interface Movie {
    id: number
    title?: string
    name?: string
    overview: string
    backdrop_path: string | null
    poster_path: string | null
    vote_average: number
    release_date?: string
    first_air_date?: string
    media_type?: string
}

interface CategoryRow {
    title: string
    movies: Movie[]
}

const fetchFromTMDB = async (endpoint: string): Promise<Movie[]> => {
    if (!TMDB_API_KEY) return []
    try {
        const res = await fetch(`${TMDB_BASE_URL}${endpoint}?api_key=${TMDB_API_KEY}&language=en-US`)
        const data = await res.json()
        return data.results || []
    } catch {
        return []
    }
}

function MovieCard({ movie, isLarge = false }: { movie: Movie; isLarge?: boolean }) {
    const [isHovered, setIsHovered] = useState(false)
    const [isInList, setIsInList] = useState(false)
    const imagePath = isLarge ? movie.poster_path : movie.backdrop_path || movie.poster_path
    const imageUrl = imagePath ? `${TMDB_IMAGE_BASE}/${isLarge ? 'w342' : 'w500'}${imagePath}` : '/placeholder.jpg'

    // Generate a fake "match" percentage based on movie id
    const matchPercent = 70 + (movie.id % 30)
    // Random badge for some movies
    const showNewBadge = movie.id % 5 === 0
    const showTopTenBadge = movie.id % 7 === 0

    return (
        <div
            className={`movie-card ${isLarge ? 'large' : ''}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            data-ph-capture-attribute-movie-title={movie.title || movie.name}
            data-ph-capture-attribute-movie-id={movie.id}
        >
            {showNewBadge && <span className="card-badge new">NEW</span>}
            {showTopTenBadge && !showNewBadge && <span className="card-badge top">TOP 10</span>}
            <img src={imageUrl} alt={movie.title || movie.name || 'Movie'} loading="lazy" />
            <div className={`card-overlay ${isHovered ? 'visible' : ''}`}>
                <h4>{movie.title || movie.name}</h4>
                <div className="card-meta">
                    <span className="match">{matchPercent}% Match</span>
                    <span className="maturity">TV-MA</span>
                    <span className="year">{(movie.release_date || movie.first_air_date || '').split('-')[0]}</span>
                </div>
                <p className="card-overview">{movie.overview}</p>
                <div className="card-buttons">
                    <button className="play-btn" data-ph-capture-attribute-action="play">
                        ▶
                    </button>
                    <button
                        className={`add-list-btn ${isInList ? 'added' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation()
                            setIsInList(!isInList)
                        }}
                        data-ph-capture-attribute-action={isInList ? 'remove-from-list' : 'add-to-list'}
                    >
                        {isInList ? '✓' : '+'}
                    </button>
                    <button className="like-btn" data-ph-capture-attribute-action="like">
                        👍
                    </button>
                    <button className="info-btn" data-ph-capture-attribute-action="more-info">
                        ▼
                    </button>
                </div>
            </div>
        </div>
    )
}

function CategoryRowComponent({
    title,
    movies,
    isLarge = false,
}: {
    title: string
    movies: Movie[]
    isLarge?: boolean
}) {
    const rowRef = useRef<HTMLDivElement>(null)
    const [showLeftArrow, setShowLeftArrow] = useState(false)
    const [showRightArrow, setShowRightArrow] = useState(true)

    const scroll = (direction: 'left' | 'right') => {
        if (!rowRef.current) return
        const scrollAmount = rowRef.current.clientWidth * 0.8
        rowRef.current.scrollBy({
            left: direction === 'left' ? -scrollAmount : scrollAmount,
            behavior: 'smooth',
        })
    }

    const handleScroll = () => {
        if (!rowRef.current) return
        const { scrollLeft, scrollWidth, clientWidth } = rowRef.current
        setShowLeftArrow(scrollLeft > 0)
        setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10)
    }

    useEffect(() => {
        const ref = rowRef.current
        if (ref) {
            ref.addEventListener('scroll', handleScroll)
            handleScroll()
        }
        return () => ref?.removeEventListener('scroll', handleScroll)
    }, [movies])

    if (movies.length === 0) return null

    return (
        <div className="category-row">
            <h3 className="category-title">{title}</h3>
            <div className="row-container">
                {showLeftArrow && (
                    <button className="scroll-btn left" onClick={() => scroll('left')}>
                        ‹
                    </button>
                )}
                <div className={`movies-row ${isLarge ? 'large' : ''}`} ref={rowRef}>
                    {movies.map((movie) => (
                        <MovieCard key={movie.id} movie={movie} isLarge={isLarge} />
                    ))}
                </div>
                {showRightArrow && (
                    <button className="scroll-btn right" onClick={() => scroll('right')}>
                        ›
                    </button>
                )}
            </div>
        </div>
    )
}

function HeroSection({ movie }: { movie: Movie | null }) {
    if (!movie) return null

    const backdropUrl = movie.backdrop_path ? `${TMDB_IMAGE_BASE}/original${movie.backdrop_path}` : null

    return (
        <div className="hero-section" style={{ backgroundImage: backdropUrl ? `url(${backdropUrl})` : undefined }}>
            <div className="hero-gradient" />
            <div className="hero-content">
                <h1 className="hero-title">{movie.title || movie.name}</h1>
                <p className="hero-overview">{movie.overview}</p>
                <div className="hero-buttons">
                    <button className="hero-play-btn" data-ph-capture-attribute-action="play-hero">
                        ▶ Play
                    </button>
                    <button className="hero-info-btn" data-ph-capture-attribute-action="more-info-hero">
                        ℹ More Info
                    </button>
                </div>
                <div className="hero-meta">
                    <span className="hero-rating">★ {movie.vote_average.toFixed(1)}</span>
                    <span className="hero-year">
                        {(movie.release_date || movie.first_air_date || '').split('-')[0]}
                    </span>
                </div>
            </div>
        </div>
    )
}

function HogflixHeader() {
    const [scrolled, setScrolled] = useState(false)

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 50)
        window.addEventListener('scroll', handleScroll)
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    return (
        <header className={`hogflix-header ${scrolled ? 'scrolled' : ''}`}>
            <div className="header-left">
                <h1 className="hogflix-logo">
                    <span className="hog">HOG</span>
                    <span className="flix">FLIX</span>
                </h1>
                <nav className="header-nav">
                    <a href="#" className="active">
                        Home
                    </a>
                    <a href="#">TV Shows</a>
                    <a href="#">Movies</a>
                    <a href="#">New & Popular</a>
                    <a href="#">My List</a>
                </nav>
            </div>
            <div className="header-right">
                <button className="search-btn">🔍</button>
                <button className="notifications-btn">🔔</button>
                <div className="profile-btn">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/0/0b/Netflix-avatar.png" alt="Profile" />
                </div>
            </div>
        </header>
    )
}

export default function Hogflix() {
    const [categories, setCategories] = useState<CategoryRow[]>([])
    const [featuredMovie, setFeaturedMovie] = useState<Movie | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const loadData = async () => {
            if (!TMDB_API_KEY) {
                setLoading(false)
                return
            }

            const [trending, popular, topRated, upcoming, popularTV, topRatedTV] = await Promise.all([
                fetchFromTMDB('/trending/movie/week'),
                fetchFromTMDB('/movie/popular'),
                fetchFromTMDB('/movie/top_rated'),
                fetchFromTMDB('/movie/upcoming'),
                fetchFromTMDB('/tv/popular'),
                fetchFromTMDB('/tv/top_rated'),
            ])

            // Pick a random trending movie for the hero
            if (trending.length > 0) {
                const randomIndex = Math.floor(Math.random() * Math.min(5, trending.length))
                setFeaturedMovie(trending[randomIndex])
            }

            setCategories([
                { title: 'Trending Now', movies: trending },
                { title: 'Popular Movies', movies: popular },
                { title: 'Top Rated', movies: topRated },
                { title: 'Coming Soon', movies: upcoming },
                { title: 'Popular TV Shows', movies: popularTV },
                { title: 'Top Rated TV Shows', movies: topRatedTV },
            ])

            setLoading(false)
        }

        loadData()
    }, [])

    if (!TMDB_API_KEY) {
        return (
            <div className="hogflix-page">
                <Head>
                    <title>Hogflix - Setup Required</title>
                </Head>
                <style jsx global>
                    {hogflixStyles}
                </style>
                <div className="setup-message">
                    <h1 className="hogflix-logo-large">
                        <span className="hog">HOG</span>
                        <span className="flix">FLIX</span>
                    </h1>
                    <p>To use Hogflix, add your TMDB API key to your environment:</p>
                    <code>NEXT_PUBLIC_TMDB_API_KEY=your_api_key</code>
                    <p>
                        Get a free API key at{' '}
                        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer">
                            themoviedb.org
                        </a>
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="hogflix-page">
            <Head>
                <title>Hogflix</title>
            </Head>
            <style jsx global>
                {hogflixStyles}
            </style>

            <HogflixHeader />

            {loading ? (
                <div className="loading-container">
                    <div className="loading-spinner" />
                </div>
            ) : (
                <>
                    <HeroSection movie={featuredMovie} />
                    <div className="categories-container">
                        {categories.map((category, index) => (
                            <CategoryRowComponent
                                key={category.title}
                                title={category.title}
                                movies={category.movies}
                                isLarge={index === 0}
                            />
                        ))}
                    </div>
                </>
            )}

            {/* Floating Product Tour Button */}
            <button className="product-tour-btn" data-attr="hogflix-product-tour">
                Launch Product Tour
            </button>
        </div>
    )
}

const hogflixStyles = `
    /* Override global styles for full-screen experience */
    body {
        background: #141414 !important;
    }

    main {
        max-width: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
    }

    /* Hide the default page header */
    main > .sticky.top-0.bg-white {
        display: none !important;
    }

    /* Hide cookie consent banner on Hogflix page */
    .fixed.right-2.bottom-2.border.rounded.p-2.bg-gray-100 {
        display: none !important;
    }

    .hogflix-page {
        background: #141414;
        min-height: 100vh;
        color: #fff;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        overflow-x: hidden;
    }

    .hogflix-page main,
    .hogflix-page {
        max-width: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
    }

    /* Header */
    .hogflix-header {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 100;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px 60px;
        background: linear-gradient(180deg, rgba(0,0,0,0.7) 10%, transparent);
        transition: background 0.3s ease;
    }

    .hogflix-header.scrolled {
        background: #141414;
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 40px;
    }

    .hogflix-logo {
        font-size: 1.8rem;
        font-weight: 900;
        letter-spacing: 2px;
        margin: 0;
    }

    .hogflix-logo .hog {
        color: #F54E00;
    }

    .hogflix-logo .flix {
        color: #fff;
    }

    .header-nav {
        display: flex;
        gap: 20px;
    }

    .header-nav a {
        color: #e5e5e5;
        text-decoration: none;
        font-size: 14px;
        font-weight: 400;
        transition: color 0.3s;
    }

    .header-nav a:hover,
    .header-nav a.active {
        color: #fff;
        font-weight: 500;
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 20px;
    }

    .header-right button {
        background: none;
        border: none;
        color: #fff;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
    }

    .profile-btn img {
        width: 32px;
        height: 32px;
        border-radius: 4px;
    }

    /* Hero Section */
    .hero-section {
        position: relative;
        height: 85vh;
        min-height: 500px;
        background-size: cover;
        background-position: center top;
        display: flex;
        align-items: center;
    }

    .hero-gradient {
        position: absolute;
        inset: 0;
        background: linear-gradient(
            77deg,
            rgba(0,0,0,0.9) 0%,
            rgba(0,0,0,0.4) 50%,
            transparent 100%
        ),
        linear-gradient(
            180deg,
            transparent 60%,
            rgba(20,20,20,1) 100%
        );
    }

    .hero-content {
        position: relative;
        z-index: 1;
        padding: 0 60px;
        max-width: 600px;
    }

    .hero-title {
        font-size: 3.5rem;
        font-weight: 700;
        margin: 0 0 20px;
        text-shadow: 2px 2px 8px rgba(0,0,0,0.8);
    }

    .hero-overview {
        font-size: 1.2rem;
        line-height: 1.5;
        margin: 0 0 25px;
        color: #e5e5e5;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-shadow: 1px 1px 4px rgba(0,0,0,0.8);
    }

    .hero-buttons {
        display: flex;
        gap: 15px;
        margin-bottom: 20px;
    }

    .hero-play-btn,
    .hero-info-btn {
        padding: 12px 30px;
        border: none;
        border-radius: 4px;
        font-size: 1.1rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: all 0.2s ease;
    }

    .hero-play-btn {
        background: #fff;
        color: #000;
    }

    .hero-play-btn:hover {
        background: #e5e5e5;
    }

    .hero-info-btn {
        background: rgba(109, 109, 110, 0.7);
        color: #fff;
    }

    .hero-info-btn:hover {
        background: rgba(109, 109, 110, 0.5);
    }

    .hero-meta {
        display: flex;
        gap: 15px;
        font-size: 1rem;
    }

    .hero-rating {
        color: #46d369;
        font-weight: 600;
    }

    .hero-year {
        color: #999;
    }

    /* Categories */
    .categories-container {
        position: relative;
        margin-top: -100px;
        padding-bottom: 60px;
        z-index: 2;
    }

    .category-row {
        margin-bottom: 40px;
    }

    .category-title {
        font-size: 1.4rem;
        font-weight: 600;
        margin: 0 0 15px;
        padding: 0 60px;
        color: #e5e5e5;
    }

    .row-container {
        position: relative;
    }

    .movies-row {
        display: flex;
        gap: 10px;
        padding: 0 60px;
        overflow-x: auto;
        scroll-behavior: smooth;
        scrollbar-width: none;
        -ms-overflow-style: none;
    }

    .movies-row::-webkit-scrollbar {
        display: none;
    }

    .scroll-btn {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 60px;
        background: rgba(20, 20, 20, 0.7);
        border: none;
        color: #fff;
        font-size: 3rem;
        cursor: pointer;
        z-index: 10;
        opacity: 0;
        transition: opacity 0.3s;
    }

    .row-container:hover .scroll-btn {
        opacity: 1;
    }

    .scroll-btn:hover {
        background: rgba(20, 20, 20, 0.9);
    }

    .scroll-btn.left {
        left: 0;
    }

    .scroll-btn.right {
        right: 0;
    }

    /* Movie Card */
    .movie-card {
        flex-shrink: 0;
        width: 250px;
        position: relative;
        border-radius: 4px;
        overflow: hidden;
        cursor: pointer;
        transition: transform 0.3s ease, z-index 0s 0.3s;
    }

    .movie-card.large {
        width: 180px;
    }

    .movie-card:hover {
        transform: scale(1.3);
        z-index: 20;
        transition: transform 0.3s ease, z-index 0s;
    }

    .movie-card img {
        width: 100%;
        height: auto;
        display: block;
        aspect-ratio: 16/9;
        object-fit: cover;
        background: #333;
    }

    .movie-card.large img {
        aspect-ratio: 2/3;
    }

    .card-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(transparent, rgba(0,0,0,0.95));
        padding: 60px 15px 15px;
        opacity: 0;
        transform: translateY(20px);
        transition: all 0.3s ease;
    }

    .card-overlay.visible {
        opacity: 1;
        transform: translateY(0);
    }

    .card-overlay h4 {
        margin: 0 0 8px;
        font-size: 1rem;
        font-weight: 600;
    }

    .card-meta {
        display: flex;
        gap: 10px;
        margin-bottom: 8px;
        font-size: 0.85rem;
    }

    .card-meta .rating {
        color: #46d369;
    }

    .card-meta .year {
        color: #999;
    }

    .card-overview {
        font-size: 0.75rem;
        color: #aaa;
        margin: 0 0 10px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .card-badge {
        position: absolute;
        top: 8px;
        left: 8px;
        padding: 4px 8px;
        border-radius: 3px;
        font-size: 0.65rem;
        font-weight: 700;
        letter-spacing: 0.5px;
        z-index: 5;
    }

    .card-badge.new {
        background: #E50914;
        color: #fff;
    }

    .card-badge.top {
        background: linear-gradient(135deg, #b4925a 0%, #8c6b3e 100%);
        color: #fff;
    }

    .card-meta .match {
        color: #46d369;
        font-weight: 600;
    }

    .card-meta .maturity {
        border: 1px solid #999;
        padding: 0 4px;
        font-size: 0.7rem;
    }

    .card-buttons {
        display: flex;
        gap: 6px;
    }

    .card-buttons button {
        width: 32px;
        height: 32px;
        padding: 0;
        border: 2px solid rgba(255,255,255,0.5);
        border-radius: 50%;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        background: rgba(20,20,20,0.8);
        color: #fff;
    }

    .card-buttons button:hover {
        border-color: #fff;
        transform: scale(1.1);
    }

    .card-buttons .play-btn {
        background: #fff;
        color: #000;
        border-color: #fff;
    }

    .card-buttons .play-btn:hover {
        background: #e5e5e5;
    }

    .card-buttons .add-list-btn.added {
        background: #46d369;
        border-color: #46d369;
    }

    .card-buttons .info-btn {
        margin-left: auto;
    }

    /* Loading */
    .loading-container {
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .loading-spinner {
        width: 60px;
        height: 60px;
        border: 4px solid #333;
        border-top-color: #F54E00;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    /* Setup Message */
    .setup-message {
        height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 20px;
    }

    .hogflix-logo-large {
        font-size: 4rem;
        font-weight: 900;
        letter-spacing: 4px;
        margin: 0 0 40px;
    }

    .hogflix-logo-large .hog {
        color: #F54E00;
    }

    .hogflix-logo-large .flix {
        color: #fff;
    }

    .setup-message p {
        font-size: 1.1rem;
        color: #999;
        margin: 10px 0;
    }

    .setup-message code {
        display: block;
        background: #222;
        padding: 15px 30px;
        border-radius: 8px;
        font-size: 1rem;
        margin: 20px 0;
        color: #46d369;
    }

    .setup-message a {
        color: #F54E00;
        text-decoration: none;
    }

    .setup-message a:hover {
        text-decoration: underline;
    }

    /* Product Tour Button */
    .product-tour-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 200;
        background: #F54E00;
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 12px 20px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        transition: all 0.2s ease;
    }

    .product-tour-btn:hover {
        background: #ff6a2b;
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
    }

    /* Responsive */
    @media (max-width: 768px) {
        .hogflix-header {
            padding: 10px 20px;
        }

        .header-nav {
            display: none;
        }

        .hero-content {
            padding: 0 20px;
        }

        .hero-title {
            font-size: 2rem;
        }

        .hero-overview {
            font-size: 1rem;
        }

        .category-title,
        .movies-row {
            padding: 0 20px;
        }

        .movie-card {
            width: 150px;
        }

        .movie-card.large {
            width: 120px;
        }

        .movie-card:hover {
            transform: scale(1.05);
        }

        .scroll-btn {
            width: 40px;
            font-size: 2rem;
        }
    }
`
