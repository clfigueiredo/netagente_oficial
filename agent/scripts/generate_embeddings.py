"""Generate embeddings for knowledge_base entries that don't have them yet."""
import asyncio
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

import asyncpg

async def main():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set")
        return

    conn = await asyncpg.connect(db_url)
    rows = await conn.fetch(
        "SELECT id, title, content FROM public.knowledge_base WHERE embedding IS NULL"
    )
    print(f"Found {len(rows)} entries without embeddings")

    if not rows:
        await conn.close()
        return

    from memory.rag import get_embedding

    for row in rows:
        text = f"{row['title']}\n{row['content']}"
        try:
            embedding = await get_embedding(text)
            vector_str = f"[{','.join(str(x) for x in embedding)}]"
            await conn.execute(
                "UPDATE public.knowledge_base SET embedding = $1::vector WHERE id = $2",
                vector_str, row["id"]
            )
            print(f"  ✅ {row['title'][:50]}")
        except Exception as e:
            print(f"  ❌ {row['title'][:50]}: {e}")

    count = await conn.fetchval(
        "SELECT COUNT(*) FROM public.knowledge_base WHERE embedding IS NOT NULL"
    )
    print(f"\nDone! {count} entries now have embeddings.")
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
