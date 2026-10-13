export function repository(db: D1Database) {
  return {
    statement(sql: string, ...values: any[]) {
      return db.prepare(sql).bind(...values);
    },
    async get(sql: string, ...values: any[]) {
      return db
        .prepare(sql)
        .bind(...values)
        .first<any>();
    },
    async all(sql: string, ...values: any[]) {
      return (
        await db
          .prepare(sql)
          .bind(...values)
          .all<any>()
      ).results;
    },
    async run(sql: string, ...values: any[]) {
      return db
        .prepare(sql)
        .bind(...values)
        .run();
    },
    async batch(statements: D1PreparedStatement[]) {
      return db.batch(statements);
    },
    audit(user: any, action: string, entity: string, detail: any) {
      return db
        .prepare(
          "INSERT INTO audit(actor,action,entity,detail,ts) VALUES(?,?,?,?,?)",
        )
        .bind(user.id, action, entity, JSON.stringify(detail), Date.now());
    },
    // A CHECK guard inside the same D1 batch makes concurrent stale commands roll back.
    guard(sql: string, ...values: any[]) {
      const id = crypto.randomUUID();
      return {
        id,
        statement: db
          .prepare(
            `INSERT INTO command_guards(id,ok) VALUES (?, CASE WHEN (${sql}) THEN 1 ELSE 0 END)`,
          )
          .bind(id, ...values),
        cleanup: db.prepare("DELETE FROM command_guards WHERE id=?").bind(id),
      };
    },
  };
}
export type Repository = ReturnType<typeof repository>;
