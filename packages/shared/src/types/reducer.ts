/** Pure reducer: given a state and an action, produces a new state without mutation. */
export type Reducer<S, A> = (state: S, action: A) => S;
