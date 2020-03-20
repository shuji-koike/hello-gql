import Knex from "knex";
import Dataloader, { BatchLoadFn } from "dataloader";

export class Loader<Key, Row> {
  private keys: Key[] = [];
  private rows: Row[] = [];
  private callbacks: ((rows: Row[]) => void)[] = [];
  private knex: Knex;
  dataloader: Dataloader<Key, Row>;
  constructor(
    knex: Knex,
    load: (keys: readonly Key[]) => Promise<Row[]>,
    find: (key: Key, rows: Row[]) => Row
  ) {
    this.knex = knex;
    this.dataloader = new Dataloader(async keys => {
      const rows = await load(keys);
      return keys.map(key => find(key, rows));
    });
  }
  async select(
    table: string,
    ...fn: (((q: Knex.QueryBuilder) => Knex.QueryBuilder) | undefined)[]
  ): Promise<Row[]> {
    let select = this.knex.select().from(table);
    fn.forEach(fn => (select = fn ? fn(select) : select));
    console.debug(select.toString());
    return select;
  }
  batch(key: Key, load: (keys: Key[]) => Promise<Row[]>): Promise<Row[]> {
    this.keys.push(key);
    return new Promise(resolve => {
      this.callbacks.push(resolve);
      setTimeout(async () => {
        if (this.keys.length == 0) return;
        const keys = this.keys.slice();
        const callbacks = this.callbacks.slice();
        this.keys.length = 0;
        (await load(keys)).forEach(e => this.rows.push(e));
        callbacks.forEach(e => e(this.rows));
      });
    });
  }
}
