import { getCollection } from 'astro:content';

export async function GET() {
    const devlogs = await getCollection('devlog');
    const races = await getCollection('race');
    const books = await getCollection('books');

    // 公開日の新しい順にソートして最新5件をフォーマット
    const formattedDevlogs = devlogs
        .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
        .slice(0, 5)
        .map(p => ({
            id: p.id,
            title: p.data.title,
            pubDate: p.data.pubDate.toISOString().split('T')[0].replace(/-/g, '.'),
            tag: p.data.tag
        }));

    const formattedRaces = races
        .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
        .slice(0, 5)
        .map(p => ({
            id: p.id,
            title: p.data.title,
            pubDate: p.data.pubDate.toISOString().split('T')[0].replace(/-/g, '.'),
            circuit: p.data.circuit
        }));

    const formattedBooks = books
        .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
        .slice(0, 5)
        .map(p => ({
            id: p.id,
            title: p.data.title,
            pubDate: p.data.pubDate.toISOString().split('T')[0].replace(/-/g, '.'),
            event: p.data.event
        }));

    return new Response(
        JSON.stringify({
            devlog: formattedDevlogs,
            race: formattedRaces,
            books: formattedBooks
        }),
        {
            status: 200,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        }
    );
}
