/* eslint-ignore @typescript-eslint/no-use-before-define */

import {
	MalVal,
	MalFunc,
	createMalFunc,
	isMalFunc,
	cloneExp,
	isKeyword,
	LispError,
	symbolFor as S,
	isSymbol,
	M_ISMACRO,
	M_ENV,
	M_PARAMS,
	M_AST,
	M_EVAL,
	M_FN,
	isMap,
	MalMap,
	isList,
	isVector,
	markMalVector,
	MalNode,
	isMalNode
} from './types'
import Env from './env'
import printExp from './printer'

// eval
const isPair = (x: MalVal) => Array.isArray(x) && x.length > 0

function quasiquote(exp: any): MalVal {
	if (!isPair(exp)) {
		return [S('quote'), exp]
	} else if (exp[0] === S('unquote')) {
		return exp[1]
	} else if (isPair(exp[0]) && exp[0][0] === S('splice-unquote')) {
		return [S('concat'), exp[0][1], quasiquote(exp.slice(1))]
	} else {
		return [S('cons'), quasiquote(exp[0]), quasiquote(exp.slice(1))]
	}
}

function macroexpand(exp: MalVal = null, env: Env) {
	while (isList(exp) && isSymbol(exp[0]) && env.find(exp[0] as string)) {
		const fn = env.get(exp[0] as string) as MalFunc
		;(exp as MalNode)[M_FN] = fn
		if (!fn[M_ISMACRO]) {
			break
		}
		exp = fn(...exp.slice(1))
	}
	return exp
}

function evalAtom(exp: MalVal, env: Env, saveEval: boolean) {
	if (isSymbol(exp)) {
		return env.get(exp as string)
	} else if (Array.isArray(exp)) {
		const ret = exp.map(x => {
			// eslint-disable-next-line @typescript-eslint/no-use-before-define
			const ret = evalExp(x, env, saveEval)
			if (saveEval && isMalNode(x)) {
				x[M_EVAL] = ret
			}
			return ret
		})
		if (saveEval) {
			;(exp as MalNode)[M_EVAL] = ret
		}
		return isVector(exp) ? markMalVector(ret) : ret
	} else if (isMap(exp)) {
		const hm: MalMap = {}
		for (const k in exp) {
			// eslint-disable-next-line @typescript-eslint/no-use-before-define
			const ret = evalExp(exp[k], env, saveEval)
			if (saveEval && isMalNode(exp[k])) {
				;(exp[k] as MalNode)[M_EVAL] = ret
			}
			hm[k] = ret
		}
		if (saveEval) {
			;(exp as MalNode)[M_EVAL] = hm
		}
		return hm
	} else {
		return exp
	}
}

export default function evalExp(
	exp: MalVal,
	env: Env,
	saveEval = false
): MalVal {
	const _ev = saveEval

	// eslint-disable-next-line no-constant-condition
	while (true) {
		if (!isList(exp)) {
			return evalAtom(exp, env, _ev)
		}

		const expandedAst = macroexpand(exp, env)
		if (_ev) {
			;(exp as MalNode)[M_EVAL] = expandedAst
		}
		exp = expandedAst

		if (!isList(exp)) {
			return evalAtom(exp, env, _ev)
		}

		if (exp.length === 0) {
			return exp
		}

		// Apply list
		const [a0, a1, a2, a3] = exp

		// Special Forms
		switch (isSymbol(a0) ? (a0 as string).slice(1) : Symbol(':default')) {
			case 'def': {
				const ret = env.set(a1 as string, evalExp(a2, env, _ev))
				if (_ev) {
					;(exp as MalNode)[M_FN] = env.get(S('def'))
					;(exp as MalNode)[M_EVAL] = ret
				}
				return ret
			}
			case 'let': {
				const letEnv = new Env(env)
				const binds = a1 as MalVal[]
				for (let i = 0; i < binds.length; i += 2) {
					letEnv.bindAll(
						binds[i] as any,
						evalExp(binds[i + 1], letEnv, _ev) as MalVal[]
					)
				}
				env = letEnv
				const ret = exp.length === 3 ? a2 : [S('do'), ...exp.slice(2)]
				if (_ev) {
					;(exp as MalNode)[M_EVAL] = ret
				}
				exp = ret
				break // continue TCO loop
			}
			case 'quote':
				if (_ev) {
					;(exp as MalNode)[M_EVAL] = a1
				}
				return a1
			case 'quasiquote': {
				const ret = quasiquote(a1)
				if (_ev) {
					;(exp as MalNode)[M_EVAL] = ret
				}
				exp = ret
				break // continue TCO loop
			}
			case 'macro': {
				const fnexp = [S('fn'), a1, a2]
				const fn = cloneExp(evalExp(fnexp, env, _ev)) as MalFunc
				fn[M_ISMACRO] = true
				return fn
			}
			case 'macroexpand': {
				const ret = macroexpand(a1, env)
				if (_ev) {
					;(exp as MalNode)[M_EVAL] = ret
				}
				return ret
			}
			case 'try':
				try {
					const ret = evalExp(a1, env, _ev)
					if (_ev) {
						;(exp as MalNode)[M_EVAL] = ret
					}
					return ret
				} catch (exc) {
					let err = exc
					if (a2 && Array.isArray(a2) && a2[0] === S('catch')) {
						if (exc instanceof Error) {
							err = exc.message
						}
						const ret = evalExp(
							a2[2],
							new Env(env, [a2[1] as string], [err]),
							_ev
						)
						if (_ev) {
							;(exp as MalNode)[M_EVAL] = ret
						}
						return ret
					} else {
						throw err
					}
				}
			case 'do': {
				evalAtom(exp.slice(1, -1), env, _ev)
				const ret = exp[exp.length - 1]
				if (_ev) {
					;(exp as MalNode)[M_EVAL] = ret
				}
				exp = ret
				break // continue TCO loop
			}
			case 'if': {
				const cond = evalExp(a1, env, _ev)
				if (cond) {
					if (_ev) {
						;(exp as MalNode)[M_EVAL] = a2
					}
					exp = a2
				} else {
					if (_ev) {
						;(exp as MalNode)[M_EVAL] = a3
					}
					exp = typeof a3 !== 'undefined' ? a3 : null
				}
				break // continue TCO loop
			}
			case 'fn':
				return createMalFunc(
					(...args) => evalExp(a2, new Env(env, a1 as string[], args), _ev),
					a2,
					env,
					a1 as string[]
				)
			case 'eval-when-execute': {
				const ret = evalExp(a1, env, _ev)
				if (_ev) {
					;(exp as MalNode)[M_EVAL] = ret
				}
				exp = ret
				break
			}
			/*
			case 'env-chain': {
				let _env: Env | null = env
				const envs = []

				do {
					envs.push(_env)
					_env = _env.outer
				} while (_env)

				exp = [S('println'), envs.map(e => e.name).join(' <- ')]
				break // continue TCO loop
			}
			case 'which-env': {
				let _env: Env | null = env
				const envs = []

				do {
					envs.push(_env)
					_env = _env.outer
				} while (_env)

				exp = [
					S('println'),
					envs
						.filter(e => e.hasOwn(a1 as string))
						.map(e => e.name)
						.join(' <- ') || 'not defined'
				]
				break
			}
			*/
			default: {
				// Apply Function
				const [_fn, ...args] = evalAtom(exp, env, saveEval) as MalVal[]

				const fn = _fn as MalFunc

				if (isMalFunc(fn)) {
					env = new Env(fn[M_ENV], fn[M_PARAMS], args)
					if (saveEval) {
						;(exp as MalNode)[M_EVAL] = fn[M_AST]
						;(exp as MalNode)[M_FN] = fn
					}
					exp = fn[M_AST]
					break // continue TCO loop
				} else if (typeof fn === 'function') {
					const ret = (fn as any)(...args)
					if (saveEval) {
						;(exp as MalNode)[M_EVAL] = ret
						;(exp as MalNode)[M_FN] = fn
					}
					return ret
				} else {
					let typename = ''

					if (isKeyword(fn)) {
						typename = 'Keyword '
					} else if (Array.isArray(fn)) {
						typename = 'List '
					}
					throw new LispError(
						`[EVAL] ${typename} ${printExp(
							fn
						)} is not a function. First element of list always should be a function.`
					)
				}
			}
		}
	}
}
