import { Store, PreloadedState, Reducer, createStore, AnyAction, Middleware, compose, applyMiddleware } from 'redux';
import { IReducers } from '../reducers/BaseReducer';
import { StoreNotFoundError } from '../exceptions/StoreNotFoundError';
import { BaseModel } from '../models/BaseModel';
import { Persist, PersistStorage } from './Persist';
import ACTION_TYPES from '../utils/actionType';

export interface ReduxStoreConfig<Engine extends string = 'memory'> {
  reducers?: IReducers;
  compose?: 'default' | 'redux-devtools' | typeof compose;
  middleware?: Middleware[];
  preloadedState?: PreloadedState<any>;
  /**
   * @deprecated Will be removed at v9.0.0
   */
  onCombineReducers?: (reducer: Reducer) => Reducer;
  persist?: {
    version: string | number;
    /**
     * The storage key
     */
    key: string;
    storage: PersistStorage | Engine;
    /**
     * {
     *   xModel,
     *   yModel,
     *   zModel,
     * }
     */
    allowlist: Record<string, BaseModel<any>>;
  };
}

export class StoreHelper {
  protected readonly _persist: Persist;
  protected _store?: Store;
  protected reducers: IReducers = {};
  protected dispatching: boolean = false;
  protected state: object = {};
  /**
   * @deprecated
   */
  protected onCombined: ReduxStoreConfig['onCombineReducers'];

  constructor() {
    this._persist = new Persist(this);
  }

  createStore(config: ReduxStoreConfig = {}): Store {
    const { onCombineReducers, reducers, preloadedState, middleware } = config;
    const customCompose = (() => {
      switch (config.compose) {
        case 'redux-devtools':
          return typeof window === 'object' && window['__REDUX_DEVTOOLS_EXTENSION_COMPOSE__'] || compose;
        case 'default':
          return compose;
        default:
          return config.compose || compose;
      }
    })();
    const persist = this._persist;

    if (onCombineReducers) {
      console.error('[Warning] onCombineReducers is deprecated and will be removed at v9.0.0');
      this.onCombined = onCombineReducers;
    }

    reducers && Object.keys(reducers).forEach((key) => {
      this.reducers[key] = reducers[key];
    });

    persist.setConfig(config.persist);

    const combined = this.combineReducers();

    if (this._store) {
      // Avoid to dispatch persist data of @@redux/x.y.z triggerred by replaceReducer()
      persist.rehydrate();
      this.store.replaceReducer(combined);
    } else {
      this._store = createStore(
        combined,
        preloadedState,
        customCompose(applyMiddleware.apply(null, middleware || []))
      );
      persist.rehydrate();
    }

    return this.store;
  }

  appendReducers(autoReducer: IReducers): void {
    // Only 0-1 reducer will be provided.
    const key = Object.keys(autoReducer)[0];

    if (key) {
      const exists = this.reducers.hasOwnProperty(key);
      this.reducers[key] = autoReducer[key];

      if (!exists && this._store) {
        this._store.replaceReducer(this.combineReducers());
      }
    }
  }

  get store(): Store {
    if (!this._store) {
      throw new StoreNotFoundError();
    }

    return this._store;
  }

  get persist(): Persist {
    return this._persist;
  }

  dispatch<T extends AnyAction>(action: T): T {
    return this.store.dispatch(action);
  }

  getState(): { readonly [key: string]: any } {
    return this.dispatching ? this.state : this.store.getState();
  }

  onCreated(fn: () => void): Function {
    return this.persist.listenOnce(fn);
  }

  protected combineReducers(): Reducer {
    const reducerKeys = Object.keys(this.reducers);
    const keyLength = reducerKeys.length;

    let combined: Reducer = (state, action) => {
      if (state === undefined) {
        state = {};
      }

      this.dispatching = true;
      this.state = state;

      const nextState = {};
      let hasChanged = false;

      for (let i = 0; i < keyLength; ++i) {
        const key = reducerKeys[i];
        const reducer = this.reducers[key];
        const previousStateForKey = state[key];
        const nextStateForKey = reducer(previousStateForKey, action);

        nextState[key] = nextStateForKey;
        hasChanged = hasChanged || nextStateForKey !== previousStateForKey;
      }

      hasChanged = hasChanged || keyLength !== Object.keys(state).length;

      if (hasChanged) {
        this.persist.update(nextState, action.type === ACTION_TYPES.persist);
      }

      this.dispatching = false;
      this.state = {};

      return hasChanged ? nextState : state;
    };

    if (this.onCombined) {
      return this.onCombined(combined);
    }

    return combined;
  }
}

export const storeHelper = new StoreHelper();
