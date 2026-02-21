import fs from 'fs';
import path from 'path';
import Link from 'next/link';
import RefreshButton from './RefreshButton';

// Prevent static generation — this page reads from the filesystem at runtime
export const dynamic = 'force-dynamic';

interface Post {
    url: string;
    postUrn: string;
    content: string;
    imageUrl: string;
    likes: number;
    comments: number;
    reposts: number;
    impressionsText: string;
    date?: string;
}

export default function DashboardPage() {
    const filePath = path.join(process.cwd(), 'data', 'posts_enriched.json');
    let posts: Post[] = [];

    try {
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            posts = JSON.parse(fileContent);
        }
    } catch (error) {
        console.error("Error reading posts enriched file:", error);
    }

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <header className="mb-8 flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">LinkedIn Analytics Dashboard</h1>
                        <p className="text-gray-500 mt-2">
                            Showing metrics for {posts.length} recent posts.
                            <span className="text-sm ml-2 bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                Last updated via script
                            </span>
                        </p>
                    </div>
                    <div className="mt-1">
                        <RefreshButton />
                    </div>
                </header>

                {posts.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-lg shadow">
                        <p className="text-gray-500 text-lg">No posts data found.</p>
                        <p className="text-sm text-gray-400 mt-2">Run `npm run script:fetch-analytics` to generate data.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {posts.map((post) => (
                            <div key={post.postUrn} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
                                {/* Image Section */}
                                <div className="aspect-video bg-gray-100 relative overflow-hidden">
                                    {post.imageUrl ? (
                                        <img
                                            src={post.imageUrl}
                                            alt="Post visual"
                                            className="object-cover w-full h-full"
                                            referrerPolicy="no-referrer"
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-gray-400">
                                            No Image
                                        </div>
                                    )}
                                </div>

                                {/* Content Section */}
                                <div className="p-5">
                                    <div className="flex justify-between items-start mb-3">
                                        {post.date && (
                                            <span className="inline-block bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full font-medium border border-blue-100">
                                                {post.date}
                                            </span>
                                        )}
                                    </div>

                                    <div className="mb-4">
                                        <p className="text-gray-800 text-sm line-clamp-3 leading-relaxed">
                                            {post.content || "No text content available."}
                                        </p>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-2 gap-4 mb-4 py-3 border-t border-b border-gray-50">
                                        <div className="text-center">
                                            <span className="block text-xl font-bold text-gray-900">{post.impressionsText}</span>
                                            <span className="text-xs text-gray-500 uppercase tracking-wide">Impressions</span>
                                        </div>
                                        <div className="text-center">
                                            <span className="block text-xl font-bold text-gray-900">{post.likes}</span>
                                            <span className="text-xs text-gray-500 uppercase tracking-wide">Likes</span>
                                        </div>
                                        <div className="text-center">
                                            <span className="block text-xl font-bold text-gray-900">{post.comments}</span>
                                            <span className="text-xs text-gray-500 uppercase tracking-wide">Comments</span>
                                        </div>
                                        <div className="text-center">
                                            <span className="block text-xl font-bold text-gray-900">{post.reposts}</span>
                                            <span className="text-xs text-gray-500 uppercase tracking-wide">Reposts</span>
                                        </div>
                                    </div>

                                    {/* Footer */}
                                    <div className="flex justify-end">
                                        <Link
                                            href={post.url}
                                            target="_blank"
                                            className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
                                        >
                                            View on LinkedIn
                                            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
