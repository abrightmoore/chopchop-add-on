//  The World Foundry

import * as mc from "@minecraft/server";
import * as mcui from "@minecraft/server-ui";
let DEBUG = false
// const dimensions = [ mc.world.getDimension("overworld"), mc.world.getDimension("nether"), mc.world.getDimension("the_end") ];

const NAMESPACE = "twf_cc:"
const GUIDE_BOOK_NAME = "Chop Chop Guide"
const GUIDE_BOOK_ITEM = "minecraft:book"
const BLOCK_TOOL_ENABLED_KEY = NAMESPACE+"blocktoolenabled"
const ENABLED_KEY = NAMESPACE+"enabled"
const NOTIFY_KEY = NAMESPACE+"notify"
const SOUNDS_KEY = NAMESPACE+"sounds"
const DESTROY_KEY = NAMESPACE+"destroy"
const UNDO_KEY = NAMESPACE+"perplayerundo"
const MSG_PREFIX = "[Chop Chop]"
const FIRST_BOOK_ACCESS = NAMESPACE+"first_book_read"
const GAMEMODE_CREATIVE = "Creative"
const GAMEMODE_SURVIVAL = "Survival"
const GAMEMODE_ADVENTURE = "Adventure"

const CHOPPER_FRAME_AMT = 7
const CHOPPER_MAX_AGE = 64
const CHOPPER_AGE_KEY = NAMESPACE+"age"

// SETTINGS
let jobs = [];	// Var in case we need to dump them all suddenly.
let jobs_completed = [];
const JOB_IDX_PLAYER = 0;
const JOB_IDX_STARTTIME = 1;
const JOB_IDX_DIMLOCSTART = 2;
const JOB_IDX_DIMLOCPLAYER = 3;
const JOB_IDX_PLAYERTOOL = 4;
const JOB_IDX_PLAYERGAMEMODE = 5;
const JOB_IDX_JOBTYPE = 6;
const JOB_IDX_BLOCKORIGINAL = 7;
const JOB_IDX_BLOCKREPLACEMENT = 8;
const JOB_IDX_BLOCKDROPCHANCE = 9;
const JOB_IDX_DIMLOCPROCESSED = 10;
const JOB_IDX_DIMLOCPLANNED = 11;
const JOB_IDX_STATE = 12;
const JOB_IDX_ERROR = 13;
const JOB_IDX_UNDO = 14;


const JOB_BLOCKFLOODREPLACE = "BFR";
const JOB_BLOCKFLOODREPLACEUNDO = "BFRU";
const JOB_STATE_RUN = "RUN"
const JOB_STATE_HOLD = "HOLD"
const JOB_STATE_STOP = "STOP"


let chopchop_types = [
	"log", "leave", "stem", "wart", "vine", "mushroom_block"
]

let pickpick_types = [
	"_ore"
]


let destroy_block = "minecraft:air";
let CONST_AXE_IDENT = "axe";
let CONST_PICK_IDENT = "pickaxe";

let TIMBER_SOUND_CHANCE = 0.3;
let EXFOLIATE_SOUND_CHANCE = 0.1;

let CHOPCHOP_DROP_CHANCE = 0.5;

let command_queue = undefined;
let CONST_COMMAND_LIMIT = 100;

let undo = new Map();

let work = undefined;
let CONST_WORK_LIMIT = 60;

let intent = undefined; // If work can't be scheduled, it goes onto the intent queue to be picked up when idle
let CONST_INTENT_LIMIT = 10000;

let SCHED_FRAME_AMT = 1;

let CONST_FRAMECHANGE_TIME_LIMIT = 45; // 20260220a was 100

let CONST_WORK_TIME_LIMIT = 35;
let CONST_INTENT_TIME_LIMIT = 20;
let CONST_RUN_COMMANDS_TIME_LIMIT = 30;

let iteration = 0;
let command_immediate = undefined;

function initialise_work_qs() {
	work = new Map();
	command_queue = new Map();
	intent = new Map();
	command_immediate = [];
}
initialise_work_qs();

// FUNCTIONS

function get_dynamic_property_with_default(player, key, def_val) {
	let prop = player.getDynamicProperty(key);
	if(prop == undefined) {
		prop = def_val;
		player.setDynamicProperty(key, prop);
	}
	return prop
}

function notify_player(player, msg) {
	let notify = get_dynamic_property_with_default(player, NOTIFY_KEY, true);

	if(notify) {
		player.sendMessage(MSG_PREFIX+String(msg));
	}
}

function give_spawn_item(player, itemTypeId, qty, name) {
	const initialised_on_spawn = name + ' init';
	if(player.getDynamicProperty(initialised_on_spawn) === undefined) {
		let item = new mc.ItemStack(itemTypeId, qty);
		item.nameTag = name;
		player.dimension.spawnItem(item, player.location);
		player.setDynamicProperty(initialised_on_spawn, 1);
		// Other custom properties to be initialised on first world join
	};
};

mc.world.afterEvents.playerSpawn.subscribe(event => {
	const players = mc.world.getPlayers( { playerId: event.playerId } );
	for ( let player of players ) {
		get_dynamic_property_with_default(player, NOTIFY_KEY, true);
		if(!player.getDynamicProperty(NAMESPACE+"guide_init")) {
			give_spawn_item(player, GUIDE_BOOK_ITEM, 1, GUIDE_BOOK_NAME);
		}
	}
});

// GUIDE MANAGEMENT

mc.world.afterEvents.itemUse.subscribe(async (event) => {
    const { source: player, itemStack } = event;
		if (itemStack.typeId.includes("book")) {
			if (itemStack.nameTag === GUIDE_BOOK_NAME) {
				if(!get_dynamic_property_with_default(player, FIRST_BOOK_ACCESS, true)) {
					guide_page_generic_show(player, "introduction"); // Show intro on first access
				} else {
					if(player.getGameMode() == GAMEMODE_CREATIVE) {
						guide_book_jobs_show(player);
					} else {
						guide_page_generic_show(player, "introduction");
					}
				}
			};
		};
    });

const generic_button_keys = [
	"settings",
	"jobcontrol",
	"about",
	"close"
]
function guide_page_generic_show(player, key) {
	let this_form = new mcui.ActionFormData();
	let suffix = "";
	if(player.getGameMode() == GAMEMODE_CREATIVE) {
		suffix = "_creative"
	}
	
	this_form.title({rawtext: [{translate:  "twf_cc:guide."+key+suffix+".title", with: ["\n"]}]});
	this_form.body({rawtext:  [{translate:  "twf_cc:guide."+key+suffix+".body", with: ["\n"]}]});

	for(let bkey of generic_button_keys) {
		this_form.button({rawtext: [{translate: "twf_cc:guide."+bkey+".button",with: ["\n"]}]})
	}

	this_form.show(player).then((response) => {
		if(response) {
			if(response.selection != undefined) {
				get_dynamic_property_with_default(player, FIRST_BOOK_ACCESS, false); // Skip the intro next time
				if(response.selection == generic_button_keys.length-1) {
					return; // Close with no action
				} else {
					for(let i = 0; i < generic_button_keys.length-1; i++) {
						if(response.selection == i) {
							if(i == generic_button_keys.indexOf(generic_button_keys[0])) {
								// show settings
								if (player.getGameMode() != GAMEMODE_CREATIVE) {
									guide_settings_show(player);
								} else {
									guide_creative_settings_show(player);
								}
							} else if(i == generic_button_keys.indexOf(generic_button_keys[1])) {
								// show jobcontrol
								if (player.getGameMode() != GAMEMODE_CREATIVE) {
									guide_page_generic_show(player, "tasks")
								} else {
									guide_book_jobs_show(player);
								}
							} else {
								guide_page_generic_show(player, generic_button_keys[response.selection]);
							}
						}
					}
				}
			}
		}		
	});
};

function guide_settings_show(player) {
	let this_form = new mcui.ModalFormData();
	this_form.title({rawtext: [{translate: "twf_cc:guide.settings.title",with: ["\n"]}]});

	let enabled = get_dynamic_property_with_default(player, ENABLED_KEY, true);
	enabled = get_dynamic_property_with_default(player, ENABLED_KEY, true);
	this_form.toggle({rawtext: [{translate: "twf_cc:settings.form.enabled",with: ["\n"]}]}, { defaultValue: enabled });
	
	let notify = get_dynamic_property_with_default(player, NOTIFY_KEY, true);
	notify = get_dynamic_property_with_default(player, NOTIFY_KEY, true);
	this_form.toggle({rawtext: [{translate: "twf_cc:settings.form.notify",with: ["\n"]}]}, { defaultValue: notify });

	let sounds = get_dynamic_property_with_default(player, SOUNDS_KEY, true);
	sounds = get_dynamic_property_with_default(player, SOUNDS_KEY, true);
	this_form.toggle({rawtext: [{translate: "twf_cc:settings.form.sounds",with: ["\n"]}]}, { defaultValue: sounds });

	let destroy = get_dynamic_property_with_default(player, DESTROY_KEY, CHOPCHOP_DROP_CHANCE);
	destroy = get_dynamic_property_with_default(player, DESTROY_KEY, CHOPCHOP_DROP_CHANCE);
	this_form.textField({rawtext: [{translate: "twf_cc:settings.form.destroy", with: ["\n"]}]}, String(destroy), { defaultValue: String(destroy) });

	let undopp = get_dynamic_property_with_default(player, UNDO_KEY, false);
	undopp = get_dynamic_property_with_default(player, UNDO_KEY, false);
	this_form.toggle({rawtext: [{translate: "twf_cc:settings.form.undoperplayer",with: ["\n"]}]}, { defaultValue: undopp });
	
	this_form.show(player).then((formData) => {
		if(formData.cancelled) {

		}
		else {
			if( formData.formValues[0] != undefined ) {
				player.setDynamicProperty(ENABLED_KEY, formData.formValues[0]);
			}
			if( formData.formValues[1] != undefined ) {
				player.setDynamicProperty(NOTIFY_KEY, formData.formValues[1]);
			}
			if( formData.formValues[2] != undefined ) {
				player.setDynamicProperty(SOUNDS_KEY, formData.formValues[2]);
			}
			if( formData.formValues[3] != undefined ) {
				try {
					let val = parseFloat(formData.formValues[3])
					if(!isNaN(val)) player.setDynamicProperty(DESTROY_KEY, val);
				} catch(error) {
					if(DEBUG) mc.world.sendMessage("[twf_cc] "+String(error) + "\n" + String(error.stack));
				}
			}
			if( formData.formValues[4] != undefined ) {
				player.setDynamicProperty(UNDO_KEY, formData.formValues[4]);
			}
		}
	}).catch((error) => {
	});	
};

function guide_book_jobs_show(player) {
	let this_form = new mcui.ActionFormData();
	this_form.title({rawtext: [{translate: "twf_cc:guide.jobs.title",with: ["\n"]}]});
	
	let active_status = "";
	if(jobs.length == 0) {
		active_status = "not "
	}
	
	let body = "You manage any running, suspended or completed jobs here. Disable and enable undo for any running task, or remove any floating items in loaded chunks. Chop Chop is currently §b"+active_status+"§rperforming tasks.\nThere are:\n§b"+String(command_queue.size)+"§r pending commands\n§b"+String(jobs.length)+" §rtasks, and §b"+String(jobs_completed.length)+"§r completed tasks. "
	if(jobs.length > 0) {
		body += "\nScroll down to see and manage running tasks"
	}
	this_form.body(body);
	this_form.button({rawtext: [{translate: "twf_cc:guide.jobs_all_completed.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.jobs_all_hold.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.jobs_all_cancel.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.clearitems.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.nightvision.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.nightvisionoff.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.survival.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.settings_creative.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.settings.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.about_creative.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.close.button",with: ["\n"]}]})

	let button_name = undefined;
	let timestamp = undefined;
	for(let job of jobs) {
		timestamp = new Date(job[JOB_IDX_STARTTIME]).toString().replaceAll("+0000","")
		button_name = ""
		
		
		if(job[JOB_IDX_JOBTYPE] == JOB_BLOCKFLOODREPLACE) {
			button_name += "Swap"
		} else if(job[JOB_IDX_JOBTYPE] == JOB_BLOCKFLOODREPLACEUNDO) {
			button_name += "Undo"
		} else {
			button_name += "????"
		}
		
		button_name += "@"+timestamp+" "+titleCase(job[JOB_IDX_BLOCKORIGINAL].replaceAll("minecraft:","").replaceAll("_"," "))
		if(job[JOB_IDX_STATE] == JOB_STATE_HOLD) {
			button_name += " HELD"
		}
		this_form.button(button_name)
		
	}

	this_form.show(player).then((response) => {
		if(response) {
			if(response.selection != undefined) {
				if(response.selection == 0) {
					guide_book_jobs_completed_show(player);
				} else if(response.selection == 1) {
					for(let j of jobs) {
						if(j[JOB_IDX_STATE] == JOB_STATE_RUN) {
							j[JOB_IDX_STATE] = JOB_STATE_HOLD;
						};
					};
					guide_book_jobs_show(player);
				} else if(response.selection == 2) {
					let j = undefined;
					while(jobs.length > 0) {
						j = jobs.shift()
						jobs_completed.push(j);
						j[JOB_IDX_STATE] = JOB_STATE_STOP;
					};
					guide_book_jobs_show(player);
				} else if(response.selection == 3) {
					command_immediate.push([player, "/kill @e[type=Item]"]);
					guide_book_jobs_show(player);
				} else if(response.selection == 4) {
					command_immediate.push([player, "/effect @s night_vision infinite 1 true"]);
					guide_book_jobs_show(player);
				} else if(response.selection == 5) {
					command_immediate.push([player, "/effect @s clear night_vision"]);
					guide_book_jobs_show(player);
				} else if(response.selection == 6) {
					command_immediate.push([player, "/effect @s clear night_vision"]);
					command_immediate.push([player, "/gamemode survival"]);

				} else if(response.selection == 7) {
					guide_creative_settings_show(player);
				} else if(response.selection == 8) {
					guide_settings_show(player);
				} else if(response.selection == 9) {
					guide_page_generic_show(player, "about");
				} else if(response.selection == 10) {
					return;
				} else { // Player clicked on a running or suspended job
					guide_book_job_control_show(player, jobs[response.selection-11]);
				}
			}
		}		
	});	
}

function guide_book_job_control_show(player, job) {
	let this_form = new mcui.ActionFormData();
	this_form.title({rawtext: [{translate: "twf_cc:guide.job_detail.title",with: ["\n"]}]});
	let body = ""
	
	body += "Owned by §b"+job[JOB_IDX_PLAYER].name + "§r\nAt x: "+String(Math.floor(job[JOB_IDX_DIMLOCPLAYER][1].x))+" y: " + String(Math.floor(job[JOB_IDX_DIMLOCPLAYER][1].y))+" z: "+String(Math.floor(job[JOB_IDX_DIMLOCPLAYER][1].z))+" in Dimension "+titleCase(String(job[JOB_IDX_DIMLOCPLAYER][0].id).replaceAll("minecraft:","").replaceAll("_"," "))+"\n";
	body += "Task is §b";

	if(job[JOB_IDX_JOBTYPE] == JOB_BLOCKFLOODREPLACE) {
		body += "Swap"
	} else if(job[JOB_IDX_JOBTYPE] == JOB_BLOCKFLOODREPLACEUNDO) {
		body += "Undo"
	} else {
		body += "????"
	}
	body += "§r\nBlock §b"+job[JOB_IDX_BLOCKORIGINAL]+"§r replaced by §b"+job[JOB_IDX_BLOCKREPLACEMENT] + "§r\n";

	body += "Started @"+new Date(job[JOB_IDX_STARTTIME]).toString().replaceAll("+0000","") + "\n";
	body += "Task @ x: "+String(job[JOB_IDX_DIMLOCSTART][1].x)+" y: " + String(job[JOB_IDX_DIMLOCSTART][1].y)+" z: "+String(job[JOB_IDX_DIMLOCSTART][1].z)+" in Dimension "+titleCase(String(job[JOB_IDX_DIMLOCSTART][0].id).replaceAll("minecraft:","").replaceAll("_"," "))+"\n";
	body += "Using "+titleCase(String(job[JOB_IDX_PLAYERTOOL]).replaceAll("minecraft:","").replaceAll("_"," "))+"tool, ";
	body += "in game mode "+job[JOB_IDX_PLAYERGAMEMODE]+"\n";
	body += "Block destroy chance is "+String(job[JOB_IDX_BLOCKDROPCHANCE]*100)+"%\n";

	body += "Planned blocks count "+String(job[JOB_IDX_DIMLOCPLANNED].size)+"\n";

	if(job[JOB_IDX_ERROR] != "") body += "Message: "+job[JOB_IDX_ERROR]+"\n";
	
	this_form.body(body);
	
	this_form.button("Run state: "+job[JOB_IDX_STATE] + " (toggle)"); // Toggle run/hold
	this_form.button("Cancel Task");
	this_form.button("Undo state: "+String(job[JOB_IDX_UNDO]) + " (toggle)"); // Toggle run/hold
	this_form.button("Discard "+String(job[JOB_IDX_DIMLOCPROCESSED].size)+" completed blocks");
	this_form.button({rawtext: [{translate: "twf_cc:guide.goback.button",with: ["\n"]}]});
	this_form.button({rawtext: [{translate: "twf_cc:guide.close.button",with: ["\n"]}]});
	
	
	this_form.show(player).then((response) => {
		if(response) {
			if(response.selection != undefined) {
				if(response.selection == 0) {
					if(job[JOB_IDX_STATE] == JOB_STATE_HOLD) {
						job[JOB_IDX_STATE] = JOB_STATE_RUN;
					} else if(job[JOB_IDX_STATE] == JOB_STATE_RUN) {
						job[JOB_IDX_STATE] = JOB_STATE_HOLD;
					}
					guide_book_job_control_show(player, job);
				}
				if(response.selection == 1) {
					jobs_completed.push(job);
					job[JOB_IDX_STATE] = JOB_STATE_STOP;
					const index = jobs.indexOf(job);
					jobs.splice(index, 1);
					guide_book_jobs_show(player);
				}
				if(response.selection == 2) {
					job[JOB_IDX_UNDO] = !job[JOB_IDX_UNDO];
					guide_book_job_control_show(player, job);
				}
				if(response.selection == 3) {
					job[JOB_IDX_DIMLOCPROCESSED] = new Map();
					guide_book_job_control_show(player, job);
				}				
				if(response.selection == 4) {
					guide_book_jobs_show(player);
				}
				if(response.selection == 5) {
					return;
				}
			}
			
		}		
	});		
	
}

function guide_book_jobs_completed_show(player) {
	let this_form = new mcui.ActionFormData();
	this_form.title({rawtext: [{translate: "twf_cc:guide.jobscompleted.title",with: ["\n"]}]});
	
	let body = "Chop Chop has completed §b"+String(jobs_completed.length)+"§r tasks\n"
	this_form.body(body);
	
	this_form.button({rawtext: [{translate: "twf_cc:guide.removesmallcompleted.button",with: ["\n"]}]})
    this_form.button({rawtext: [{translate: "twf_cc:guide.removecompleted.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.goback.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.start.button",with: ["\n"]}]})

	let button_name = undefined;
	let timestamp = undefined;
	for(let job of jobs_completed) {
		timestamp = new Date(job[JOB_IDX_STARTTIME]).toString().replaceAll("+0000","")
		button_name = ""
		if(job[JOB_IDX_DIMLOCPROCESSED].size > 0) button_name += "§bUNDO§r ";
		if(job[JOB_IDX_JOBTYPE] == JOB_BLOCKFLOODREPLACE) {
			button_name += "Swap"
		} else if(job[JOB_IDX_JOBTYPE] == JOB_BLOCKFLOODREPLACEUNDO) {
			button_name += "Undo"
		} else {
			button_name += "????"
		}
		button_name += "@"+timestamp+" "+titleCase(job[JOB_IDX_BLOCKORIGINAL].replaceAll("minecraft:","").replaceAll("_"," "))
		button_name += " §b"+String(job[JOB_IDX_DIMLOCPROCESSED].size)+"§r blx"
		
		this_form.button(button_name)
	}

	this_form.show(player).then((response) => {
		if(response) {
			if(response.selection != undefined) {
				if(response.selection == 0) {
					// Purge completed jobs with < 100 processed blocks.
					let i = jobs_completed.length;
					let jc = [];
					let j = undefined;
					while(i > 0) {
						
						j = jobs_completed.shift();
						if(j[JOB_IDX_DIMLOCPROCESSED.size > 100]) {
							jc.push(j);
						}
						i--;
					}
					jobs_completed = jc; // May need locking around array?

					guide_book_jobs_completed_show(player);
				} else if(response.selection == 1) {
					guide_book_completed_jobs_delete_show(player);
				} else if(response.selection == 2) {
					guide_book_jobs_show(player);
				} else if(response.selection == 3) {
					return;
				} else if(response.selection > 3) { // Restart a job?
					let job = jobs_completed[response.selection-4];
					if(job[JOB_IDX_DIMLOCPROCESSED].size > 0) { // Only queue work if there's work to do
						job[JOB_IDX_DIMLOCPLANNED] = job[JOB_IDX_DIMLOCPROCESSED];
						job[JOB_IDX_DIMLOCPROCESSED] = new Map();
						job[JOB_IDX_JOBTYPE] = JOB_BLOCKFLOODREPLACEUNDO;
						jobs.push(job); // Start undo
						job[JOB_IDX_STATE] = JOB_STATE_RUN;
						jobs_completed.splice(response.selection-4, 1);
					}
					guide_book_jobs_completed_show(player)
				}
			}
		}		
	});	
}

function guide_book_completed_jobs_delete_show(player) {
	let this_form = new mcui.ActionFormData();
	this_form.title({rawtext: [{translate: "twf_cc:guide.jobscompleteddelete.title",with: ["\n"]}]});
	this_form.body({rawtext: [{translate: "twf_cc:guide.jobscompleteddelete.body",with: ["\n"]}]});
	this_form.button({rawtext: [{translate: "twf_cc:guide.goback.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.start.button",with: ["\n"]}]})	
	let button_name = undefined;
	let timestamp = undefined;
	for(let job of jobs_completed) {
		timestamp = new Date(job[JOB_IDX_STARTTIME]).toString().replaceAll("+0000","")
		button_name = "Undo "	
		if(job[JOB_IDX_JOBTYPE] == JOB_BLOCKFLOODREPLACE) {
			button_name += "Swap"
		} else if(job[JOB_IDX_JOBTYPE] == JOB_BLOCKFLOODREPLACEUNDO) {
			button_name += "Undo"
		} else {
			button_name += "????"
		}
		button_name += "@"+timestamp+" "+titleCase(job[JOB_IDX_BLOCKORIGINAL].replaceAll("minecraft:","").replaceAll("_"," "))
		
		this_form.button(button_name)
	}
	this_form.show(player).then((response) => {
		if(response) {
			if(response.selection != undefined) {
				if(response.selection == 0) {
					guide_book_jobs_completed_show(player);
				} else if(response.selection == 1) {
					return;
				} else { // Restart a job?
					jobs_completed.splice(response.selection-2, 1);
					guide_book_completed_jobs_delete_show(player)
				}
			}
		}		
	});	
}

function guide_creative_settings_show(player) {
	let this_form = new mcui.ModalFormData();
	this_form.title({rawtext: [{translate: "twf_cc:guide.creativesettings.title",with: ["\n"]}]});
	
	this_form.textField({rawtext: [{translate: "twf_cc:settings.form.destroy_block", with: ["\n"]}]}, String(destroy_block), { defaultValue: String(destroy_block) });

	let btenabled = get_dynamic_property_with_default(player, BLOCK_TOOL_ENABLED_KEY, false);
	btenabled = get_dynamic_property_with_default(player, BLOCK_TOOL_ENABLED_KEY, false);
	this_form.toggle({rawtext: [{translate: "twf_cc:settings.form.blocktoolenabled",with: ["\n"]}]}, { defaultValue: btenabled });

	this_form.textField({rawtext: [{translate: "twf_cc:settings.form.const_axe_ident", with: ["\n"]}]}, String(CONST_AXE_IDENT), { defaultValue: String(CONST_AXE_IDENT) });
	
	this_form.textField({rawtext: [{translate: "twf_cc:settings.form.timber_sound_chance", with: ["\n"]}]}, String(TIMBER_SOUND_CHANCE), { defaultValue: String(TIMBER_SOUND_CHANCE) });

	this_form.textField({rawtext: [{translate: "twf_cc:settings.form.const_command_limit", with: ["\n"]}]}, String(CONST_COMMAND_LIMIT), { defaultValue: String(CONST_COMMAND_LIMIT) });	

	this_form.textField({rawtext: [{translate: "twf_cc:settings.form.framechange_time_limit", with: ["\n"]}]}, String(CONST_FRAMECHANGE_TIME_LIMIT), { defaultValue: String(CONST_FRAMECHANGE_TIME_LIMIT) });	

	this_form.textField({rawtext: [{translate: "twf_cc:settings.form.work_time_limit", with: ["\n"]}]}, String(CONST_WORK_TIME_LIMIT), { defaultValue: String(CONST_WORK_TIME_LIMIT) });	

	this_form.textField({rawtext: [{translate: "twf_cc:settings.form.run_commands_time_limit", with: ["\n"]}]}, String(CONST_RUN_COMMANDS_TIME_LIMIT), { defaultValue: String(CONST_RUN_COMMANDS_TIME_LIMIT) });

	this_form.toggle({rawtext: [{translate: "twf_cc:settings.form.debug",with: ["\n"]}]}, { defaultValue: DEBUG });	
	
	this_form.show(player).then((formData) => {
		if(formData.cancelled) {

		}
		else {
			if( formData.formValues[0] != undefined ) {
				destroy_block = formData.formValues[0]
			}
			if( formData.formValues[1] != undefined ) {
				player.setDynamicProperty(BLOCK_TOOL_ENABLED_KEY, formData.formValues[1]);
			}
			if( formData.formValues[2] != undefined ) {
				CONST_AXE_IDENT = formData.formValues[2]
			}
			if( formData.formValues[3] != undefined ) {
				try {
					let val = parseFloat(formData.formValues[3])
					if(!isNaN(val)) TIMBER_SOUND_CHANCE = val;
				} catch(error) {
					if(DEBUG) mc.world.sendMessage("[twf_cc] "+String(error) + "\n" + String(error.stack));
				}
			}
			if( formData.formValues[4] != undefined ) {
				try {
					let val = parseInt(formData.formValues[4], 10)
					if(!isNaN(val)) CONST_COMMAND_LIMIT = val;
				} catch(error) {
					if(DEBUG) mc.world.sendMessage("[twf_cc] "+String(error) + "\n" + String(error.stack));
				}
			}
			if( formData.formValues[5] != undefined ) {
				try {
					let val = parseInt(formData.formValues[5], 10)
					if(!isNaN(val)) CONST_FRAMECHANGE_TIME_LIMIT = val;
				} catch(error) {
					if(DEBUG) mc.world.sendMessage("[twf_cc] "+String(error) + "\n" + String(error.stack));
				}
			}
			if( formData.formValues[6] != undefined ) {
				try {
					let val = parseInt(formData.formValues[6], 10)
					if(!isNaN(val)) CONST_WORK_TIME_LIMIT = val;
				} catch(error) {
					if(DEBUG) mc.world.sendMessage("[twf_cc] "+String(error) + "\n" + String(error.stack));
				}
			}
			if( formData.formValues[7] != undefined ) {
				try {
					let val = parseInt(formData.formValues[7], 10)
					if(!isNaN(val)) CONST_RUN_COMMANDS_TIME_LIMIT = val;
				} catch(error) {
					if(DEBUG) mc.world.sendMessage("[twf_cc] "+String(error) + "\n" + String(error.stack));
				}
			}
			if( formData.formValues[8] != undefined ) {
					DEBUG = formData.formValues[8]
			}

		}
	}).catch((error) => {
	});	
};

function guide_book_creative_show(player) {
	let this_form = new mcui.ActionFormData();
	this_form.title({rawtext: [{translate: "twf_cc:guide.creative.title",with: ["\n"]}]});
	this_form.body({rawtext: [{translate: "twf_cc:guide.creative.body",with: ["\n"]}]});
	
	this_form.button({rawtext: [{translate: "twf_cc:guide.clearitems.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.creativesettings.button",with: ["\n"]}]})
    this_form.button({rawtext: [{translate: "twf_cc:guide.goback.button",with: ["\n"]}]})
	this_form.button({rawtext: [{translate: "twf_cc:guide.start.button",with: ["\n"]}]})

	this_form.show(player).then((response) => {
		if(response) {
			if(response.selection != undefined) {
				if(response.selection == 0) {
					command_immediate.push([player, "/kill @e[type=Item]"]);
					guide_book_creative_show(player)
				} else if(response.selection == 1) {
					guide_book_creative_settings_show(player);
				} else if(response.selection == 2) {
					guide_book_show(player);
				}
				return;
			}
		}		
	});
};

//	BACKGROUND PROCESSES BELOW. AD-HOC EVENT DRIVEN PROCESSES ABOVE
function debug_print_job(job) {
	mc.world.sendMessage("JOB:");
	for(let i=0; i < job.length; i++) {
		mc.world.sendMessage(String(i)+": " +JSON.stringify(job[i], undefined, 2))
	}
}

function do_jobs() {
	// Do tasks on jobs within the available time budget.
	const run_start_ts = new Date().getTime();
	let run_time = 0;
	const jobs_processed = [];
	let job = undefined;
	let keep_going = true;
	let cmd = undefined
	let success = undefined
	while(jobs.length > 0 && keep_going) {
		job = jobs.shift();
		if(job[JOB_IDX_STATE] == JOB_STATE_HOLD) {	// Ignore suspended job
			jobs_processed.push(job);
		} else if(job[JOB_IDX_DIMLOCPLANNED].size > 0) { // There's something that needs doing
			if(job[JOB_IDX_JOBTYPE] == JOB_BLOCKFLOODREPLACE) {
				let check_list = [];
				let delete_list = [];
				for(let [key, dimloc] of job[JOB_IDX_DIMLOCPLANNED]) {
					
					if(Math.random() < job[JOB_IDX_BLOCKDROPCHANCE]) {
						cmd = `setblock ${dimloc[1].x} ${dimloc[1].y} ${dimloc[1].z} `+job[JOB_IDX_BLOCKREPLACEMENT]+` destroy`
					} else {
						cmd = `setblock ${dimloc[1].x} ${dimloc[1].y} ${dimloc[1].z} `+job[JOB_IDX_BLOCKREPLACEMENT]
					}
					if(!map_try_add(command_queue, key, [cmd, dimloc[0]], CONST_COMMAND_LIMIT, false)) {
						if(DEBUG) mc.world.sendMessage("command_queue.size at limit "+String(CONST_COMMAND_LIMIT));
					}
					if(job[JOB_IDX_UNDO]) job[JOB_IDX_DIMLOCPROCESSED].set(key, dimloc); // This becomes the undo set.
					
					const neighbours = neighbour_block_add_conditional(dimloc[0], dimloc[1], job[JOB_IDX_BLOCKORIGINAL]);
					if(neighbours) {						
						for (let n of neighbours) {
							check_list.push([make_location_key(n.dimension, n.location), n]);
						}
					}
					delete_list.push(key)
					run_time = new Date().getTime() - run_start_ts;
					if(run_time > CONST_WORK_TIME_LIMIT) {
						keep_going = false;
						break;; // We've exceeded our time budget! Stop processing work, exit the loop and clean up state.
					}
				}
				for(let key of delete_list) {	// Gotta remove already processed entries from the planned queue.
					job[JOB_IDX_DIMLOCPLANNED].delete(key);
				}
				for(let key of check_list) { // Gotta add matching neighbours back
					job[JOB_IDX_DIMLOCPLANNED].set(key[0], [key[1].dimension, key[1].location])
				}
			} else if(job[JOB_IDX_JOBTYPE] == JOB_BLOCKFLOODREPLACEUNDO) {
				let delete_list = [];
				for(let [key, dimloc] of job[JOB_IDX_DIMLOCPLANNED]) {
					cmd = `setblock ${dimloc[1].x} ${dimloc[1].y} ${dimloc[1].z} `+job[JOB_IDX_BLOCKORIGINAL];
					success = true
					if(!map_try_add(command_queue, key, [cmd, dimloc[0]], CONST_COMMAND_LIMIT, false)) {
						if(DEBUG) mc.world.sendMessage("command_queue.size at limit "+String(CONST_COMMAND_LIMIT));
						success = false
					}
					if(success) {	// Only move ahead if this last attempt to add a command succeeded.
						if(job[JOB_IDX_UNDO]) job[JOB_IDX_DIMLOCPROCESSED].set(key, dimloc);
						delete_list.push(key);
					}
					run_time = new Date().getTime() - run_start_ts;
					if(run_time > CONST_WORK_TIME_LIMIT) {
						keep_going = false;
						break;; // We've exceeded our time budget! Stop processing work, exit the loop and clean up state.
					}					
				}
				for(let key of delete_list) {	// Gotta remove already processed entries from the planned queue.
					job[JOB_IDX_DIMLOCPLANNED].delete(key);
				}				
			}
			jobs_processed.push(job);			
		} else {
			if(job[JOB_IDX_JOBTYPE] != JOB_BLOCKFLOODREPLACEUNDO) {
				jobs_completed.push(job); // Don't undo an undo
			}
			job[JOB_IDX_STATE] = JOB_STATE_STOP;
		}
	}
	
	for(let j of jobs_processed) { // Add back onto the jobs list at the end of the ring.
		jobs.push(j)
	}
}

function run_each_frame() {
	do_jobs();

	return;
};

mc.system.runInterval(() => {
	const run_start_ts = new Date().getTime();
	iteration++;
	
	// Run any pending commands requiring immediate attention. Priority queue
	let cmd_i = undefined;
	while(command_immediate.length > 0) {
		cmd_i = command_immediate.pop();
		if(cmd_i[0] && cmd_i[1]) {
			try {
				cmd_i[0].runCommand(cmd_i[1]);
			} catch(error) {
				if(DEBUG) mc.world.sendMessage("[twf_cc] "+String(error) + "\n" + String(error.stack));
			}
		}
	}
	
	try {
		if((iteration % SCHED_FRAME_AMT) == 0) {
			run_each_frame();
		}
		let keep_going = CONST_RUN_COMMANDS_TIME_LIMIT; // Milliseconds
		let command = undefined;
		let cmd = undefined;
		let start_time = undefined
		let delete_me = [];
		if(DEBUG && (work.size > 0 || command_queue.size > 0)) mc.world.sendMessage("[twf_cc] "+`I:§b${intent.size}§r W:§b${work.size}§r C:§b${command_queue.size}§r`)
		while( keep_going > 0 && command_queue.size > 0) {  // There is work to be done! Do your best
			start_time = new Date().getTime();
			let before = command_queue.size
			command = command_queue.entries().next().value;
			// mc.world.sendMessage(String(before)+" " + String(command_queue.size))
			if(command) {
				cmd = command[1][0]
				if(cmd) {
					// mc.world.getDimension(command[1][1]).runCommand(cmd);
					try {
						command[1][1].runCommand(cmd);
					} catch(error) {
						if(DEBUG) mc.world.sendMessage("[twf_cc] "+String(error) + "\n" + String(error.stack));
					} finally {
						command_queue.delete(command[0]);
					}
				}
			}
			keep_going -= new Date().getTime() - start_time
		}


	} catch(error) {
        if(DEBUG) mc.world.sendMessage("[twf_cc] Error in mc.system.runInterval: "+String(error)+"\n"+String(error.stack));
	};
	

	let run_time = new Date().getTime() - run_start_ts;
	if(run_time > CONST_FRAMECHANGE_TIME_LIMIT) {
		SCHED_FRAME_AMT += 3;
	} else {
		SCHED_FRAME_AMT -= 1;
	}
	if(SCHED_FRAME_AMT < 1) {
		SCHED_FRAME_AMT = 1;
	}
	if(DEBUG && SCHED_FRAME_AMT > 1) mc.world.sendMessage("Frame interval = "+String(SCHED_FRAME_AMT))
}, 1);

function neighbour_block_add_conditional(dimension, block_loc, type_id) {
	let blockn = undefined;
	const neighbours = [];
	
	let dirval = Math.floor(Math.random() * 4)
	
	for (let y=-1; y <2; y++) {
		for (let z=-1; z <2; z++) {
			for (let x=-1; x <2; x++) {
				try {
					if( !(x==0 && y==0 && z==0) ) {

						if(dirval == 0) { blockn = dimension.getBlock({x:block_loc.x-x, y:block_loc.y-y, z:block_loc.z-z});
						} else if (dirval == 1) { blockn = dimension.getBlock({x:block_loc.x-x, y:block_loc.y-y, z:block_loc.z+z});
						} else if (dirval == 2) { blockn = dimension.getBlock({x:block_loc.x+x, y:block_loc.y-y, z:block_loc.z-z});
						} else { blockn = dimension.getBlock({x:block_loc.x+x, y:block_loc.y-y, z:block_loc.z+z}); }

						if(blockn && blockn.typeId == type_id) {	// Add only if it strictly matches typeId
							neighbours.push( blockn );
						}
					}
				} catch(error) {
					if(DEBUG) mc.world.sendMessage("[twf_cc] "+String(error)+" "+String(error.stack))
					continue;
				}
			}
		}
	}
	return neighbours;	// This is a list of neighbours who strictly match the reference block.
}

function map_try_add(the_map, key, val, limit, ignore_size_check) {
	if(the_map.size < limit || ignore_size_check) {
		the_map.set(key, val);
		return true;
	} else return false;
	
};


const sound_ids_log = [
	"sounds.twf.cc.timber1",
	"sounds.twf.cc.timber2",
	"sounds.twf.cc.timber3",
	"sounds.twf.cc.timber4"
]
const sound_ids_leaves = [
	"sounds.twf.cc.chopchop1",
	"sounds.twf.cc.chopchop2",
	"sounds.twf.cc.chopchop3",
	"sounds.twf.cc.chopchop4",
	"sounds.twf.cc.chopchop5",
	"sounds.twf.cc.chopchop6",
	"sounds.twf.cc.chopchop7",
	"sounds.twf.cc.chopchop8",
	"sounds.twf.cc.chopchop9"
]
const sound_ids_exfoliate = [
	"sounds.twf.cc.exfoliate1",
	"sounds.twf.cc.exfoliate2",
	"sounds.twf.cc.exfoliate3",
	"sounds.twf.cc.exfoliate4",
	"sounds.twf.cc.exfoliate5",
	"sounds.twf.cc.exfoliate6",
	"sounds.twf.cc.exfoliate7"
]

/*
	A JOB is a record that describes the incremental replacement of blocks via 3D flood fill.
	- What: Original block (what the Player broke) and New block (replacing it).
	        This also provides the undo hints.
	- Where: Dimension and location
	- When: Start time, runtime, complete time. Provides status... you can cancel a not-completed job.
	- How: Smallest data structures so it can scale for large areas of changes.
	- Why: Creative voxel painting.

*/
mc.world.afterEvents.playerBreakBlock.subscribe(evt => {
	return; // Not yet implemented - tools mapping to blocks is arbitrary.
	
	const block = evt.block;
	const block_permutation = evt.brokenBlockPermutation;
	const block_itm = block_permutation.getItemStack(1);

	let enabled = get_dynamic_property_with_default(evt.player, ENABLED_KEY, true); // Could be undefined. Check again.
	enabled = get_dynamic_property_with_default(evt.player, ENABLED_KEY, true);	
	if (enabled) {
		let found = false;
		if(evt.player.getGameMode() != GAMEMODE_CREATIVE) {
			if(evt.itemStackBeforeBreak.typeId.includes(CONST_PICK_IDENT)) {
				for(let type of pickpick_types) {
					if(block_itm.typeId.includes(type)) {
						// we're using a pickaxe
						// Did a block drop - brokenBlockPermutation will tell us in the after events handler
						// TODO: Check if an item dropped. It tells us this tool is the correct one for this block type.
						//     see https://minecraft.fandom.com/wiki/Pickaxe
						found = true;
					}
				}
			}
		}
		if (found) {
			const start_loc_key = make_location_key(block.dimension, block.location)
			const job = [ 
				evt.player, // 0
				new Date().getTime(), // 1
				[block.dimension, block.location], // 2
				[evt.player.dimension, evt.player.location], // 3
				evt.itemStackBeforeBreak.typeId, //4
				evt.player.getGameMode(), // 5
				JOB_BLOCKFLOODREPLACE, // 6
				block_itm.typeId, // 7
				"minecraft:air", // 8
				1.0, // 9	Always destroy ores
				new Map(), // 10
				new Map(), // 11
				JOB_STATE_RUN, // 12
				"", // Error
				get_dynamic_property_with_default(evt.player, UNDO_KEY, false) // Undo is per-player
			];
			job[JOB_IDX_DIMLOCPLANNED].set(start_loc_key, [block.dimension, block.location]);
			
			if(job[JOB_IDX_BLOCKREPLACEMENT] != job[JOB_IDX_BLOCKORIGINAL]) {
				jobs.push(job);	// A Job is a unit of work.
				notify_player(evt.player, "  Chop Chop "+titleCase(block_itm.typeId.replaceAll("minecraft:","").replaceAll("_"," "))+"!");
				
				let sounds = get_dynamic_property_with_default(evt.player, SOUNDS_KEY, true); // Could be undefined. Check again.
				sounds = get_dynamic_property_with_default(evt.player, SOUNDS_KEY, true);
				
				if(evt.player && sounds) {
					let sound_id = sound_ids_leaves[Math.floor(Math.random()*sound_ids_leaves.length)];

					command_immediate.push([evt.player, "/playsound "+sound_id+" @s ~ ~ ~ 1.0 "+String(1.3+Math.random()*0.5)]);
				}
			} else {
				notify_player(evt.player, " The same block type was selected. No changes applied")
			}
		}
	}
})

mc.world.beforeEvents.playerBreakBlock.subscribe(evt => {
	const block = evt.block; // This is the broken block. Has dimloc, etc.

	let enabled = get_dynamic_property_with_default(evt.player, ENABLED_KEY, true); // Could be undefined. Check again.
	enabled = get_dynamic_property_with_default(evt.player, ENABLED_KEY, true);	
	
	if (enabled && !block.typeId.includes(":air")) {
		let found = false;
		let tool_is_block = false;
		if(evt.player.getGameMode() != GAMEMODE_CREATIVE) {
			if(evt.itemStack && evt.itemStack.typeId.includes(CONST_AXE_IDENT)) {
				for(let type of chopchop_types) {
					if(block.typeId.includes(type)) found = true;
				}
			}
		} else {
			// Creative handling
			if(evt.itemStack) {
				if(evt.itemStack.typeId == GUIDE_BOOK_ITEM && evt.itemStack.nameTag == GUIDE_BOOK_NAME) {
					found = true;
				} else {	// Allows use to use any item as the replacement block
					if(mc.BlockTypes.get(evt.itemStack.typeId) && get_dynamic_property_with_default(evt.player, BLOCK_TOOL_ENABLED_KEY, false)) {
						tool_is_block = true;
						found=true;
					}
				}
			}
		}
		if (found) {
			// Create a new Job
			/* 
				: player (handle)
				: start time (date)
				: start DimLoc
				: player DimLoc
				: player tool
				: gamemode (string ID).. enumerate this ? Group by?
				: job type .. block fill 
				: original block .. enumerate this 
				: replacement block .. enumerate this 
				: drop chance
				: collection of DimLocs processed
				: collection of DimLocs to process next
			*/
			const start_loc_key = make_location_key(block.dimension, block.location)
			const job = [ 
				evt.player, // 0
				new Date().getTime(), // 1
				[block.dimension, block.location], // 2
				[evt.player.dimension, evt.player.location], // 3
				evt.itemStack.typeId, //4
				evt.player.getGameMode(), // 5
				JOB_BLOCKFLOODREPLACE, // 6
				block.typeId, // 7
				"minecraft:air", // 8
				get_dynamic_property_with_default(evt.player, DESTROY_KEY, CHOPCHOP_DROP_CHANCE), // 9
				new Map(), // 10
				new Map(), // 11
				JOB_STATE_RUN, // 12
				"", // Error
				get_dynamic_property_with_default(evt.player, UNDO_KEY, false) // Undo is per-player
			];
			job[JOB_IDX_DIMLOCPLANNED].set(start_loc_key, [block.dimension, block.location]);
			
			if(evt.player.getGameMode() == GAMEMODE_CREATIVE) {
				job[JOB_IDX_UNDO] = true; // Creative jobs should default to undo-enabled for safety
				job[JOB_IDX_BLOCKDROPCHANCE] = 0; // Creative jobs shouldn't cause tile drops
				job[JOB_IDX_BLOCKREPLACEMENT] = destroy_block;
				
				if(tool_is_block && get_dynamic_property_with_default(evt.player, BLOCK_TOOL_ENABLED_KEY, false)) {
					job[JOB_IDX_BLOCKREPLACEMENT] = evt.itemStack.typeId;
					// mc.world.sendMessage("Isa Block!");
				}
				// if(tool_is_block) job[JOB_IDX_BLOCKREPLACEMENT] = evt.itemStack.typeId;
				
			}
			if(job[JOB_IDX_BLOCKREPLACEMENT] != job[JOB_IDX_BLOCKORIGINAL]) {
				jobs.push(job);	// A Job is a unit of work.
				notify_player(evt.player, "  Chop Chop "+titleCase(block.typeId.replaceAll("minecraft:","").replaceAll("_"," "))+"!");
				
				let sounds = get_dynamic_property_with_default(evt.player, SOUNDS_KEY, true); // Could be undefined. Check again.
				sounds = get_dynamic_property_with_default(evt.player, SOUNDS_KEY, true);
				
				if(evt.player && sounds) {
					let sound_id = sound_ids_leaves[Math.floor(Math.random()*sound_ids_leaves.length)];
					
					if((block.typeId.includes("log") || block.typeId.includes("stem")) && Math.random() < TIMBER_SOUND_CHANCE) {
						sound_id = sound_ids_log[Math.floor(Math.random()*sound_ids_log.length)];
					} else if((block.typeId.includes("leaves")) && Math.random() < EXFOLIATE_SOUND_CHANCE) {
						sound_id = sound_ids_exfoliate[Math.floor(Math.random()*sound_ids_exfoliate.length)];
					}					
					
					command_immediate.push([evt.player, "/playsound "+sound_id+" @s ~ ~ ~ 1.0 "+String(1.3+Math.random()*0.5)]);
				}


			} else {
				notify_player(evt.player, " The same block type was selected. No changes applied")
			}
		}
	}
});

function titleCase(st) {
    return st.toLowerCase().split(" ").reduce((s, c) =>
        s + "" + (c.charAt(0).toUpperCase() + c.slice(1) + " "), '');
}


function make_location_key(dim, loc) {
	return String(dim)+" "+String(Math.floor(loc.x))+" "+String(Math.floor(loc.y))+" "+String(Math.floor(loc.z));
};

mc.system.afterEvents.scriptEventReceive.subscribe((event) => {
	if (event.id === "twf_cc:chop_job") {
		handleEntityAction(event.sourceEntity);
	}
});

function handleEntityAction(entity) {
	// A Chopper has found a block to Chop
	let cmd = undefined;
	let dx = undefined;
	let dz = undefined;
	let dy = undefined;
	let block = undefined; // 2026020a
	for(let y = -1; y < 2; y++) {
		for(let x = -1; x < 2; x++) {
			for(let z = -1; z < 2; z++) {
				dx = entity.location.x+x;
				dz = entity.location.z+z;
				dy = entity.location.y+y;

				// 20260220a - Mustn't destroy Bedrock. Turns out that's a RULE.
				try {
					block = entity.dimension.getBlock({x:dx, y:dy, z:dz});
			
					if(!block.typeId.includes(":bedrock")) {
						cmd = "/setblock "+String(dx)+" "+String(dy)+" "+String(dz)+" air destroy"
						map_try_add(command_queue, cmd, [cmd, entity.dimension], CONST_COMMAND_LIMIT, false)
					}
				} catch(error) {
					if(DEBUG) mc.world.sendMessage("[twf_cc] "+String(error) + "\n" + String(error.stack));
				};	
				// 2026022a.
			}
		}
	}

	cmd = "/playsound elytra.loop @a "+dx+" "+dy+" "+dz+" 1.0 "+String(Math.random()*2.0+1.0)
	map_try_add(command_queue, cmd, [cmd, entity.dimension], CONST_COMMAND_LIMIT, false)
	
	// decrease the chopper's useful life and expire the tool if it's at end-of-life.
	let chopper_use = get_dynamic_property_with_default(entity, CHOPPER_AGE_KEY, CHOPPER_MAX_AGE);
	chopper_use = get_dynamic_property_with_default(entity, CHOPPER_AGE_KEY, CHOPPER_MAX_AGE);
	if(chopper_use-- < 0) {
		entity.kill()
	} else {
		entity.setDynamicProperty(CHOPPER_AGE_KEY, chopper_use);
	}
}

// DRAWING LINES AND TRIANGLES

function plot_line(points, x1, y1, z1, x2, y2, z2) {
	if (points == undefined) {
		points = new Map();
	};
	
	let dx = Math.abs(x2 - x1);
	let dy = Math.abs(y2 - y1);
	let dz = Math.abs(z2 - z1);
	
	let xs = 1;
	let ys = 1;
	let zs = 1;
	
	if (x2 > x1) xs = 1;
	else xs = -1;
	
	if (y2 > y1) ys = 1;
	else ys = -1;
	
	if (z2 > z1) zs = 1;
	else zs = -1;				
	
	// Driving axis is X-axis
	if (dx >= dy && dx >= dz) {
		let p1 = 2 * dy - dx;
		let p2 = 2 * dz - dx;
		while (x1 != x2) {
			// Block blending would go here
			x1 += xs;
			if (p1 >= 0) {
				y1 += ys;
				p1 -= 2 * dx;
			}
			if (p2 >= 0) {
				z1 += zs;
				p2 -= 2 * dx;
			}
			p1 += 2 * dy;
			p2 += 2 * dz;
			
			add_point( points, {x: x1, y: y1, z: z1} );
		}				
	}
	else if (dy >= dx && dy >= dz) {
		let p1 = 2 * dx - dy;
		let p2 = 2 * dz - dy;
		while (y1 != y2) {
			// Block blending would go here
			y1 += ys;
			if (p1 >= 0) {
				x1 += xs;
				p1 -= 2 * dy;
			}
			if (p2 >= 0) {
				z1 += zs;
				p2 -= 2 * dy;
			}
			p1 += 2 * dx;
			p2 += 2 * dz;
			
			add_point( points, {x: x1, y: y1, z: z1} );
		}

		// Driving axis is Z-axis"
	}
	else {
		let p1 = 2 * dy - dz;
		let p2 = 2 * dx - dz;
		while (z1 != z2) {
			// Block blending would go here
			z1 += zs;
			if (p1 >= 0) {
				y1 += ys;
				p1 -= 2 * dz;
			}
			if (p2 >= 0) {
				x1 += xs;
				p2 -= 2 * dz;
			}
			p1 += 2 * dy;
			p2 += 2 * dx;
			
			add_point( points, {x: x1, y: y1, z: z1} );
		};
	};
	return points;
}

