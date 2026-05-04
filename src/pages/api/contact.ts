import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
	const data = await request.formData();
	const email = (data.get("email") ?? "").toString().trim();
	const company = (data.get("company") ?? "").toString().trim();
	const message = (data.get("message") ?? "").toString().trim();

	if (!email || !email.includes("@")) {
		return redirect("/contact?error=invalid-email", 303);
	}

	try {
		const db = (locals as any).runtime?.env?.DB as D1Database | undefined;
		if (db) {
			await db
				.prepare(
					`CREATE TABLE IF NOT EXISTS demo_requests (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						email TEXT NOT NULL,
						company TEXT,
						message TEXT,
						created_at TEXT NOT NULL
					)`,
				)
				.run();

			await db
				.prepare(
					`INSERT INTO demo_requests (email, company, message, created_at)
					 VALUES (?, ?, ?, ?)`,
				)
				.bind(email, company, message, new Date().toISOString())
				.run();
		}
	} catch {
		// Silently continue — don't block the user on a DB error
	}

	return redirect("/contact?success=1", 303);
};
