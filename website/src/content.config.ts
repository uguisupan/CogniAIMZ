import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// 開発ログ
const devlog = defineCollection({
    loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/devlog" }),
    schema: z.object({
        title: z.string(),
        pubDate: z.coerce.date(),
        tag: z.string(),
        description: z.string().optional(),
    }),
});

// モータースポーツ参戦記
const race = defineCollection({
    loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/race" }),
    schema: z.object({
        title: z.string(),
        pubDate: z.coerce.date(),
        circuit: z.string(),
        car: z.string(),
        bestTime: z.string().optional(),
        weather: z.string().optional(),
        description: z.string().optional(),
    }),
});

// 同人誌ログ
const books = defineCollection({
    loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/books" }),
    schema: z.object({
        title: z.string(),
        pubDate: z.coerce.date(),
        event: z.string(),
        price: z.number().optional(),
        boothUrl: z.string().url().optional(),
        description: z.string().optional(),
    }),
});

export const collections = { devlog, race, books };
