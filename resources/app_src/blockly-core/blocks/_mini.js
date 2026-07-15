'use strict';

goog.provide('Blockly.Blocks.pins');

goog.require('Blockly.Blocks');
goog.require('Blockly.Colours');
goog.require('Blockly.constants');
goog.require('Blockly.ScratchBlocks.VerticalExtensions');

Blockly.Blocks['mini_pins_high_low'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1',
      "args0": [
        {
          "type": "field_dropdown",
          "name": "NUM",
          "options": profile.default.high_low
        }
      ],
      "category": Blockly.Categories.pins,
      "extensions": ["colours__mini", "output_number"]
    });
  }
};

Blockly.Blocks['mini_setup'] = {
  init: function () {
    this.jsonInit({
      "id": "mini_setup",
      "message0": Blockly.Msg.MINI_SETUP,
      "message1": Blockly.Msg.MINI_SETUP2,
      "args0": [
        {
          "type": "field_dropdown",
          "name": "miniBegin_AA",
          "options": profile.default.miniBeginAA
        },
        {
          "type": "field_dropdown",
          "name": "miniBegin_EnUART",
          "options": profile.default.miniBeginEnUART
        },
        {
          "type": "field_dropdown",
          "name": "miniBegin_Baud",
          "options": profile.default.miniBeginBaud
        }
      ],
      "args1": [
        {
          "type": "input_statement",
          "name": "SUBSTACK"
        },
        {
          "type": "input_statement",
          "name": "SUBSTACK2"
        }
      ],

      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini"]
    });
  }
};

// MiniR4.LED.setBrightness(1, 100);
Blockly.Blocks['mini_setRGB_Brightness'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',

      "message1": Blockly.Msg.MINI_SETRGB_BRIGHTNESS,

      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/led.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],


      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [
            ["LED1", "1"],
            ["LED2", "2"]
          ]
        },
        {
          "type": "input_value",
          "name": "Brightness",
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.LED.setColor(1, R, G, B);
Blockly.Blocks['mini_setRGB'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SETRGB,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/led.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [
            ["LED1", "1"],
            ["LED2", "2"]
          ]
        },
        {
          "type": "input_value",
          "name": "R",
        },
        {
          "type": "input_value",
          "name": "G",
        },
        {
          "type": "input_value",
          "name": "B",
        },
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.Buzzer.Tone(262, 100);
Blockly.Blocks['mini_Buzzer_Tone'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_BUZZER_TONE,
      "tooltip": "This function is non-blocking | 函數執行後不會等待",
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/buzzer.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "FREQ",
        },
        {
          "type": "input_value",
          "name": "VOL",
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.Buzzer.Tone(262, 100); //NOTE_DEF
Blockly.Blocks['mini_Buzzer_ToneNote'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_BUZZER_TONENOTE,
      "tooltip": "This function is non-blocking | 函數執行後不會等待",
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/buzzer.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "FREQ",
          "options": [
            ["C3", "NOTE_C3"],
            ["D3", "NOTE_D3"],
            ["E3", "NOTE_E3"],
            ["F3", "NOTE_F3"],
            ["G3", "NOTE_G3"],
            ["A3", "NOTE_A3"],
            ["B3", "NOTE_B3"],
            ["C4", "NOTE_C4"],
            ["D4", "NOTE_D4"],
            ["E4", "NOTE_E4"],
            ["F4", "NOTE_F4"],
            ["G4", "NOTE_G4"],
            ["A4", "NOTE_A4"],
            ["B4", "NOTE_B4"],
            ["C5", "NOTE_C5"],
            ["D5", "NOTE_D5"],
            ["E5", "NOTE_E5"],
            ["F5", "NOTE_F5"],
            ["G5", "NOTE_G5"],
            ["A5", "NOTE_A5"],
            ["B5", "NOTE_B5"],
            ["C6", "NOTE_C6"]
          ],
          "default": "NOTE_C5" // Set the default to C5
        },
        {
          "type": "input_value",
          "name": "VOL",
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.Buzzer.NoTone();
Blockly.Blocks['mini_Buzzer_NoTone'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_BUZZER_NOTONE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/buzzer.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.M1.setReverse(true);
Blockly.Blocks['mini_MsetDIR'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MSETDIR,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.pwm
        },
        {
          "type": "field_dropdown",
          "name": "DIR",
          "options": [
            [AG("NO"), "false"],
            [AG("YES"), "true"]
          ]
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.M1.setSpeed(100); (actually is power, not speed)
Blockly.Blocks['mini_Mset'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MSET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.pwm
        },
        {
          "type": "input_value",
          "name": "Speed",
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.M1.setPower(100);
Blockly.Blocks['mini_MsetPower'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MSETPOWER,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.pwm
        },
        {
          "type": "input_value",
          "name": "Power",
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.M1.setSpeed(100);
Blockly.Blocks['mini_MsetSpeed'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MSETSPEED,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.pwm
        },
        {
          "type": "input_value",
          "name": "Speed",
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.M1.rotateFor(int16_t speed, uint16_t degree)
Blockly.Blocks['mini_Mrot'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      // "message1": Blockly.Msg.MINI_MSET,
      "message1": "Motor %1 Power %2 rotate for %3 degs (No Wait)",
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.pwm
        },
        {
          "type": "input_value",
          "name": "Speed",
        },
        {
          "type": "input_value",
          "name": "Degree",
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.RC1.setHWDir(true);
Blockly.Blocks['mini_RCsetDIR'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_RCSETDIR,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.rc
        },
        {
          "type": "field_dropdown",
          "name": "DIR",
          "options": [
            [AG("ON"), "false"],
            [AG("OFF"), "true"]
          ]
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.RC1.setAngle(angle);
Blockly.Blocks['mini_RCset'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_RCSET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.rc
        },
        {
          "type": "input_value",
          "name": "Angle",
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.M1.resetCounter()
Blockly.Blocks['mini_ENC_reset'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_ENC_RESET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.pwm
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.M1.getDegrees();
Blockly.Blocks['mini_ENC_get'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_ENC_GET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.pwm
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.M1.setBrake(true)
Blockly.Blocks['mini_Mbrake'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MBRAKE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.pwm
        },
        {
          "type": "field_dropdown",
          "name": "BrakeType",
          "options": [
            [AG("BRAKE"), "true"],
            [AG("COAST"), "false"]
          ]
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.BTN_UP.getState()
Blockly.Blocks['mini_BTNget'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_BTNGET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mini.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.buttons
        },
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "output_boolean", "scratch_extension"] //output_boolean
    });
  }
};

//MiniR4.A1.US.getDistance()
Blockly.Blocks['mini_USget'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_USGET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/third_party.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        },
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.D1.getL R()
Blockly.Blocks['mini_DIget'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DIGET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mini.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        },
        {
          "type": "field_dropdown",
          "name": "PIN2",
          "options": [
            [AG("LEFT"), "L"],
            [AG("RIGHT"), "R"]
          ]
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "output_boolean", "scratch_extension"] //output_boolean
    });
  }
};

//MiniR4.D1.setL()
Blockly.Blocks['mini_DOset'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DOSET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mini.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        },
        {
          "type": "field_dropdown",
          "name": "PIN2",
          "options": [
            [AG("LEFT"), "L"],
            [AG("RIGHT"), "R"]
          ]
        },
        {
          "type": "input_value",
          "name": "HIGHLOW",
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.A1.getAIL();
Blockly.Blocks['mini_AIget'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_AIGET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mini.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.analog
        },
        {
          "type": "field_dropdown",
          "name": "PIN2",
          "options": [
            [AG("LEFT"), "L"],
            [AG("RIGHT"), "R"]
          ]
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.PWR.getBattVoltage()
Blockly.Blocks['mini_PWR_getVolt'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_PWR_GETVOLT,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mini.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.Motion.resetIMUValues()
Blockly.Blocks['mini_motion_reset'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MOTION_RESET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mini-imu.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.Motion.getAccel(MiniR4Motion::AxisType::X Y Z)
Blockly.Blocks['mini_motion_getAccel'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MOTION_GETACCEL,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mini-imu.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "AXIS",
          "options": [
            ["X", "X"],
            ["Y", "Y"],
            ["Z", "Z"],
            ["X_RAW", "X_RAW"],
            ["Y_RAW", "Y_RAW"],
            ["Z_RAW", "Z_RAW"]
          ]
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.Motion.getGyro(MiniR4Motion::AxisType::X Y Z)
Blockly.Blocks['mini_motion_getGyro'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MOTION_GETGYRO,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mini-imu.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "AXIS",
          "options": [
            ["X", "X"],
            ["Y", "Y"],
            ["Z", "Z"]
          ]
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.Motion.getEuler(MiniR4Motion::AxisType::Roll Pitch Yaw)
Blockly.Blocks['mini_motion_getEuler'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MOTION_GETEULER,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mini-imu.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "AXIS",
          "options": [
            ["Roll", "Roll"],
            ["Pitch", "Pitch"],
            ["Yaw", "Yaw"]
          ]
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

// MiniR4.OLED.clearDisplay();
Blockly.Blocks['mini_OLED_clear'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_OLED_CLEAR,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/screen.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.OLED.setTextSize(3);
Blockly.Blocks['mini_OLED_setTextSize'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_OLED_SETTEXTSIZE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/screen.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "SIZE",
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.OLED.setTextColor(SSD1306_WHITE);
Blockly.Blocks['mini_OLED_setTextColor'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_OLED_SETTEXTCOLOR,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/screen.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "COLOR",
          "options": [
            [AG("WHITE"), "SSD1306_WHITE"],
            [AG("BLACK"), "SSD1306_BLACK"]
          ]
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.OLED.setCursor(10, 10);
Blockly.Blocks['mini_OLED_setCusor'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_OLED_SETCUSOR,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/screen.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "X",
        },
        {
          "type": "input_value",
          "name": "Y",
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.OLED.print(String(millis() / 1000) + "s");
Blockly.Blocks['mini_OLED_print'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_OLED_PRINT,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/screen.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "TEXT",
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.OLED.display();
Blockly.Blocks['mini_OLED_display'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_OLED_DISPLAY,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/screen.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.OLED.clearDisplay();
// MiniR4.OLED.setCursor(10, 10);
// MiniR4.OLED.print(String(millis() / 1000) + "s");
// MiniR4.OLED.display();
Blockly.Blocks['mini_OLED_printEASY'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_OLED_PRINTEASY,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/screen.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "TEXT",
        },
        {
          "type": "input_value",
          "name": "X",
        },
        {
          "type": "input_value",
          "name": "Y",
        },
        {
          "type": "field_dropdown",
          "name": "SHOW",
          "options": [
            [AG("YES"), "Yes"],
            [AG("NO"), "No"]
          ]
        }
      ],
      "category": Blockly.Categories._mini_looks,
      "extensions": ["colours__mini_looks", "shape_statement", "scratch_extension"]
    });
  }
};

//////

//MiniR4.I2C1.MXColor.begin();
Blockly.Blocks['mini_i2c_MXcolor_begin'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXCOLOR_BEGIN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_color.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.MXColor.getColorNumber();
Blockly.Blocks['mini_i2c_MXcolor_getColorNumber'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXCOLOR_GETCOLORNUMBER,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_color.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        },
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.MXColor.getColor(R G B C M Y K);
Blockly.Blocks['mini_i2c_MXcolor_getColor'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXCOLOR_GETCOLOR,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_color.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        },
        {
          "type": "field_dropdown",
          "name": "COLOR",
          "options": [
            [AG("COLOR_ID"), "ColorID"],
            [AG("RED"), "R"],
            [AG("GREEN"), "G"],
            [AG("BLUE"), "B"],
            [AG("HUE"), "H"],
            [AG("SATURATION"), "S"],
            [AG("VALUE"), "V"],
            [AG("CYAN"), "C"],
            [AG("MAGENTA"), "M"],
            [AG("YELLOW"), "Y"],
            [AG("KEY"), "K"],
          ]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.MXMotion.begin()
Blockly.Blocks['mini_i2c_MXmotion_begin'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXMOTION_BEGIN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_motion.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.MXMotion.getAccel();
Blockly.Blocks['mini_i2c_MXmotion_getAccel'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXMOTION_GETACCEL,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_motion.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        },
        {
          "type": "field_dropdown",
          "name": "AXIS",
          "options": [
            ["X", "x"],
            ["Y", "y"],
            ["Z", "z"]
          ]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.MXMotion.getGyro();
Blockly.Blocks['mini_i2c_MXmotion_getGyro'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXMOTION_GETGYRO,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_motion.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        },
        {
          "type": "field_dropdown",
          "name": "AXIS",
          "options": [
            ["X", "x"],
            ["Y", "y"],
            ["Z", "z"]
          ]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.MXMotion.getRoll();Pitch;Yaw
Blockly.Blocks['mini_i2c_MXmotion_getEULAR'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXMOTION_GETEULAR,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_motion.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        },
        {
          "type": "field_dropdown",
          "name": "AXIS",
          "options": [
            ["Pitch", "Pitch"],
            ["Roll", "Roll"],
            ["Yaw", "Yaw"]
          ]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.MXLaser.begin()
Blockly.Blocks['mini_i2c_MXlaser_begin'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLASER_BEGIN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.MXLaser.getDistance()
Blockly.Blocks['mini_i2c_MXlaser_getDistance'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLASER_GETDISTANCE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        },
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//Mini.PS2.begin();
// Blockly.Blocks['mini_ps2_begin'] = {
//   init: function() {
//     this.jsonInit({
//       "message0": Blockly.Msg.MINI_PS2_BEGIN,
//       "category": Blockly.Categories._mini_mj2,
//       "extensions": ["colours__mini_mj2", "shape_statement"]
//     });
//   }
// };

//MiniR4.PS2.read_gamepad(false, 0);
Blockly.Blocks['mini_ps2_polling'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_PS2_POLLING,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mj2.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_mj2,
      "extensions": ["colours__mini_mj2", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.PS2.Button()
Blockly.Blocks['mini_ps2_btn'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_PS2_BTN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mj2.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "BTNS",
          "options": [
            ["L1", "L1"], ["R1", "R1"], ["L2", "L2"], ["R2", "R2"], ["L3", "L3"],
            ["R3", "R3"], ["SELECT", "SELECT"], ["START", "START"], ["UP", "PAD_UP"], ["RIGHT", "PAD_RIGHT"],
            ["DOWN", "PAD_DOWN"], ["LEFT", "PAD_LEFT"], ["TRIANGLE", "TRIANGLE"], ["CIRCLE", "CIRCLE"], ["CROSS", "CROSS"], ["SQUARE", "SQUARE"]
          ]
        }
      ],
      "category": Blockly.Categories._mini_mj2,
      "extensions": ["colours__mini_mj2", "output_boolean", "scratch_extension"]
    });
  }
};

//MiniR4.PS2.Analog(PSS_LX);
Blockly.Blocks['mini_ps2_joy'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_PS2_JOY,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mj2.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "LR",
          "options": [[AG("LEFT"), "L"], [AG("RIGHT"), "R"]]
        },
        {
          "type": "field_dropdown",
          "name": "XY",
          "options": [["X", "X"], ["Y", "Y"]]
        }
      ],
      "category": Blockly.Categories._mini_mj2,
      "extensions": ["colours__mini_mj2", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.Vision.Begin();
Blockly.Blocks['mini_mvision_begin'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MVISION_BEGIN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/vision.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//int result = SmartCamReader(data);
//if (result > 0) {
Blockly.Blocks['mini_mvision_read'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MVISION_READ1, // TEXT
      "message2": "%1", //Statement
      "message3": Blockly.Msg.MINI_MVISION_READ2, // TEXT
      "message4": "%1", //Statement
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/vision.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args2": [
        {
          "type": "input_statement",
          "name": "SUBSTACK"
        }
      ],
      "args4": [
        {
          "type": "input_statement",
          "name": "SUBSTACK2"
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//CamData[n]
Blockly.Blocks['mini_mvision_getdata'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MVISION_GETDATA,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/vision.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "IDX",
          "options": [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"],
          ["8", "8"], ["9", "9"], ["10", "10"]]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_string", "scratch_extension"]
    });
  }
};

//// Serial USB

//Serial.print("hello");
Blockly.Blocks['mini_Serial_print'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL_PRINT,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/usb.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "STRING"
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "shape_statement", "scratch_extension"]
    });
  }
};

//Serial.println();
Blockly.Blocks['mini_Serial_println'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL_PRINTLN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/usb.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "STRING"
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "shape_statement", "scratch_extension"]
    });
  }
};

//Serial.write();
Blockly.Blocks['mini_Serial_write'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL_WRITE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/usb.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "STRING"
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "shape_statement", "scratch_extension"]
    });
  }
};

//Serial.println("{" + String(j) + "," + String(k) + "," + String(50) + "}");
Blockly.Blocks['mini_Serial_printAXIS'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL_PRINTAXIS,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/usb.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "NUM1",
        },
        {
          "type": "input_value",
          "name": "NUM2",
        },
        {
          "type": "input_value",
          "name": "NUM3",
        },
        {
          "type": "input_value",
          "name": "DELAY",
        },
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "shape_statement", "scratch_extension"]
    });
  }
};

//Serial.available()
Blockly.Blocks['mini_Serial_available'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL_AVAILABLE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/usb.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "output_boolean", "scratch_extension"]
    });
  }
};

//Serial.read()
Blockly.Blocks['mini_Serial_read'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL_READ,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/usb.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "output_string", "scratch_extension"]
    });
  }
};


//// Serial 1 (UART)

//Serial1.begin(9600);
Blockly.Blocks['mini_Serial1_begin'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL1_BEGIN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/serial.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "BAUD"
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "shape_statement", "scratch_extension"]
    });
  }
};

//Serial1.print("hello");
Blockly.Blocks['mini_Serial1_print'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL1_PRINT,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/serial.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "STRING"
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "shape_statement", "scratch_extension"]
    });
  }
};

//Serial1.println();
Blockly.Blocks['mini_Serial1_println'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL1_PRINTLN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/serial.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "STRING"
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "shape_statement", "scratch_extension"]
    });
  }
};

//Serial1.write();
Blockly.Blocks['mini_Serial1_write'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL1_WRITE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/serial.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "STRING"
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "shape_statement", "scratch_extension"]
    });
  }
};

//Serial1.println("{" + String(j) + "," + String(k) + "," + String(50) + "}");
Blockly.Blocks['mini_Serial1_printAXIS'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL1_PRINTAXIS,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/serial.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "NUM1",
        },
        {
          "type": "input_value",
          "name": "NUM2",
        },
        {
          "type": "input_value",
          "name": "NUM3",
        },
        {
          "type": "input_value",
          "name": "DELAY",
        },
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "shape_statement", "scratch_extension"]
    });
  }
};

//Serial1.available()
Blockly.Blocks['mini_Serial1_available'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL1_AVAILABLE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/serial.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "output_boolean", "scratch_extension"]
    });
  }
};

//Serial1.read()
Blockly.Blocks['mini_Serial1_read'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_SERIAL1_READ,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/serial.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_serial,
      "extensions": ["colours__mini_serial", "output_string", "scratch_extension"]
    });
  }
};


//millis()
Blockly.Blocks['mini_millis'] = {
  init: function () {
    this.jsonInit({
      "message0": Blockly.Msg.MINI_MILLIS,
      "category": Blockly.Categories._mini,
      "extensions": ["colours_control", "output_number"]
    });
  }
};

//randomSeed(0);
Blockly.Blocks['mini_randomSeed'] = {
  init: function () {
    this.jsonInit({
      "message0": Blockly.Msg.MINI_RANDOMSEED,
      "args0": [
        {
          "type": "input_value",
          "name": "SEED"
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours_operators", "shape_statement"]
    });
  }
};

//map(value, fromLow, fromHigh, toLow, toHigh)
Blockly.Blocks['mini_map'] = {
  init: function () {
    this.jsonInit({
      "message0": Blockly.Msg.MINI_MAP,
      "args0": [
        {
          "type": "input_value",
          "name": "VAL"
        },
        {
          "type": "input_value",
          "name": "frmL"
        },
        {
          "type": "input_value",
          "name": "frmH"
        },
        {
          "type": "input_value",
          "name": "toL"
        },
        {
          "type": "input_value",
          "name": "toH"
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours_operators", "output_number"]
    });
  }
};

//自訂代碼
Blockly.Blocks['mini_custom_code'] = {
  init: function () {
    this.jsonInit({
      "type": "multilinetext_block",
      "message0": "Multiline Text %1",
      "args0": [
        {
          "type": "field_multilinetext",
          "name": "MULTILINE_TEXT",
          "text": ""
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement"]
    });
  }
};

//自訂頭部
Blockly.Blocks['mini_custom_header'] = {
  init: function () {
    this.jsonInit({
      "message0": "Head:%1",
      "args0": [
        {
          "type": "input_value",
          "name": "TEXT",
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement"]
    });
  }
};

//timer-reset
Blockly.Blocks['mini_timer_reset'] = {
  init: function () {
    this.jsonInit({
      "message0": Blockly.Msg.MINI_TIMER_RESET,
      "args0": [
        {
          "type": "field_dropdown",
          "name": "TIMER",
          "options": [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]]
        },
      ],
      "category": Blockly.Categories._control,
      "extensions": ["colours__mini_thrdpty", "shape_statement"]
    });
  }
};

//timer-read
Blockly.Blocks['mini_timer_read'] = {
  init: function () {
    this.jsonInit({
      "message0": Blockly.Msg.MINI_TIMER_READ,
      "args0": [
        {
          "type": "field_dropdown",
          "name": "TIMER",
          "options": [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]]
        },
      ],
      "category": Blockly.Categories._control,
      "extensions": ["colours__mini_thrdpty", "output_number"]
    });
  }
};

//huskylens.begin(Serial) and #include <HUSKYLENS.h>, HUSKYLENS huskylens short hcamData[5], bool hcamIsDetect;
Blockly.Blocks['mini_huskylens_begin'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_HUSKYLENS_BEGIN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/vision.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//int result = SmartCamReader(data);
//if (result > 0) {
Blockly.Blocks['mini_huskylens_read'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_HUSKYLENS_POLLING,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/vision.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//hcamData[n]
Blockly.Blocks['mini_huskylens_getblock'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_HUSKYLENS_GETBLOCK,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/vision.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "IDX",
          "options": [["X_Center", "0"], ["Y_Center", "1"], ["Width", "2"], ["Height", "3"], ["ID", "4"]]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//hcamData[n]
Blockly.Blocks['mini_huskylens_getarrow'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_HUSKYLENS_GETARROW,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/vision.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "IDX",
          "options": [["X_Origin", "0"], ["Y_Origin", "1"], ["X_Target", "2"], ["Y_Target", "3"], ["ID", "4"]]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//mini_huskylens_isdetect
Blockly.Blocks['mini_huskylens_isdetect'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_HUSKYLENS_ISDETECT,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/vision.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_boolean", "scratch_extension"]
    });
  }
};

//MiniR4.D1.DHT11.get
Blockly.Blocks['mini_DHT11get'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DHT11GET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/third_party.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        },
        {
          "type": "field_dropdown",
          "name": "DATA",
          "options": [
            ["Temp.", "readTemperature"],
            [AG("HUMIDITY"), "readHumidity"]
          ]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.D1.DS18B20.requestTemp();
Blockly.Blocks['mini_DS18B20_polling'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DS18B20_POLLING,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/third_party.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.D1.DS18B20.requestTemp(); //.requestAndGetTemp()
Blockly.Blocks['mini_DS18B20_get'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DS18B20_GET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/third_party.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.A1.US.getDistance()
Blockly.Blocks['mini_Grove_US_Get'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_GROVE_US_GET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/third_party.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        },
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.D1.getL R()
Blockly.Blocks['mini_Grove_DIget'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_GROVE_DI_GET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/third_party.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_boolean", "scratch_extension"] //output_boolean
    });
  }
};

//MiniR4.D1.setL()
Blockly.Blocks['mini_Grove_DOset'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_GROVE_DO_SET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/third_party.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        },
        {
          "type": "input_value",
          "name": "HIGHLOW",
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.A1.getAIL();
Blockly.Blocks['mini_Grove_AIget'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_GROVE_AI_GET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/third_party.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.analog
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

///////////////////////////////////////////////

//MiniR4.I2C1.MXColorV3.begin();
Blockly.Blocks['mini_i2c_MXcolorV3_begin'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXCOLORV3_BEGIN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_color.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.MXColorV3.getR();
Blockly.Blocks['mini_i2c_MXcolorV3_getColor'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXCOLORV3_GETCOLOR,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_color.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        },
        {
          "type": "field_dropdown",
          "name": "COLOR",
          "options": [
            [AG("COLOR_ID"), "ColorID"],
            [AG("RED"), "R"],
            [AG("GREEN"), "G"],
            [AG("BLUE"), "B"],
            [AG("CLEAR"), "C"],
            [AG("HUE"), "H"],
            [AG("SATURATION"), "S"],
            [AG("VALUE"), "V"],
            
          ]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.MXColorV3.begin();
Blockly.Blocks['mini_i2c_MXGesture_begin'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXGESTURE_BEGIN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/MXGesture.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//Mini.I2C4.MXGesture.getGesture() == Code;
Blockly.Blocks['mini_i2c_MXGesture_getGesture_equals'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXGESTURE_GETGESTURE_EQUAL,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/MXGesture.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        },
        {
          "type": "field_dropdown",
          "name": "GCODE",
          "options": [
            [ "0-None", "0" ],
            [ "1-Right", "1" ],
            [ "2-Left", "2" ],
            [ "3-Up", "3" ],
            [ "4-Down", "4" ],
            [ "5-Forward", "5" ],
            [ "6-Backward", "6" ],
            [ "7-Clockwise", "7" ],
            [ "8-AntiClockwise", "8" ],
            [ "9-Wave", "9" ]
          ]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_boolean", "scratch_extension"]
    });
  }
};

//Mini.I2C4.MXGesture.getGesture();
Blockly.Blocks['mini_i2c_MXGesture_getGesture'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXGESTURE_GETGESTURE,
      "tooltip": "0: None, 1: Right, 2: Left, 3: Up, 4: Down, 5: Forward,\n 6: Backward 7: Clockwise, 8: Anti-Clockwise, 9: Wave",
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/MXGesture.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//Mini.I2C1.MXLaserV2.begin()
Blockly.Blocks['mini_i2c_MXLaserV2_begin'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLASERV2_BEGIN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};


//Mini.I2C1.MXLaserV2.getDistance();
Blockly.Blocks['mini_i2c_MXLaserV2_getDistance'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLASERV2_GETDISTANCE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

// float pin_DHT_temp;
// int pin_DHT_hum;
//MiniR4.D1.MXDHT.readTemperatureHumidity(temp, hum); // Read Temperature and Humidity in one request.
Blockly.Blocks['mini_MXDHT_Polling'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MXDHTPOLL,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/temp.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

// pin_DHT_temp; pin_DHT_hum;
Blockly.Blocks['mini_MXDHT'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MXDHT,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/temp.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        },
        {
          "type": "field_dropdown",
          "name": "PARM",
          "options": [
            [ "Temperature", "temp" ],
            [ "Humidity", "hum" ],
          ]
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//Mini.D1.MXOnewireDT.requestAndGetTemp();
Blockly.Blocks['mini_MXOnewireDT'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MXONEWIREDT,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/temp.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};


//Grayscale
//Mini.A1.getANG();
Blockly.Blocks['mini_MXGrayscale_getGrayscale'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MXGRAYSCALE_GETGRAYSCALE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/grayscale.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.analog
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//Potentiometer
//Mini.A1.getANG();
Blockly.Blocks['mini_MXPot_getPot'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MXPOT_GETPOT,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/knob.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.analog
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//WaterLevel
//Mini.A1.getANG();
Blockly.Blocks['mini_MXWaterLevel_getLevel'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MXWATERLEVEL_GETLEVEL,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/level.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.analog
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//SoilMoisture
//Mini.A1.getANG();
Blockly.Blocks['mini_MXSoilMoisture_getMoisture'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MXSOILMOISTURE_GETMOISTURE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/soil.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.analog
        }
      ],
      "category": Blockly.Categories._mini_sensors,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//MiniatureSwitch
//Mini.D1.get()
Blockly.Blocks['mini_MXMiniatureSwitch_getState'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MXMINIATURESWITCH_GETSTATE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/switch.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini_sensors", "output_boolean", "scratch_extension"]
    });
  }
};

//PIR
//Mini.D1.get()
Blockly.Blocks['mini_MXPIR_getState'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_MXPIR_GETSTATE,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/MXPIR.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.digital
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini_sensors", "output_boolean", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.HTCol.begin();
Blockly.Blocks['mini_i2c_HTcolor_begin'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_HTCOLOR_BEGIN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_color.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        }
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.I2C1.HTCol.getR();
Blockly.Blocks['mini_i2c_HTcolor_get'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_HTCOLOR_GET,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_color.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.i2c
        },
        {
          "type": "field_dropdown",
          "name": "TYPE",
          "options": [
            [AG("COLOR_ID"), "ColorNumber"],
            [AG("RED"), "R"],
            [AG("GREEN"), "G"],
            [AG("BLUE"), "B"],
            [AG("HUE"), "H"],
            [AG("SATURATION"), "S"],
            [AG("VALUE"), "V"],
          ]
        },
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

//----- Motor Control
// MiniR4.DriveDC.begin(2, 3, true, false);
Blockly.Blocks['mini_ddc_setting'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_SETTING,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PINL",
          "options": profile.default.pwm,
        },
        {
          "type": "field_dropdown",
          "name": "PINR",
          "options": profile.default.pwm,
        },
        {
          "type": "field_dropdown",
          "name": "PINL_REV",
          "options": [
            [AG("NO"), "false"],
            [AG("YES"), "true"]
          ]
        },
        {
          "type": "field_dropdown",
          "name": "PINR_REV",
          "options": [
            [AG("NO"), "false"],
            [AG("YES"), "true"]
          ]
        },
        {
          "type": "field_dropdown",
          "name": "BRAKE_SETTLE",
          "options": [
            [AG("YES"), "true"],
            [AG("NO"), "false"]
          ]
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

//----- PID Control
// MiniR4.DriveDC.setMoveSyncPID(kp, ki, kd);
// MiniR4.DriveDC.setMoveGyroPID(kp, ki, kd);
// MiniR4.DriveDC.setTurnGyroPID(kp, ki, kd);
Blockly.Blocks['mini_ddc_set_pid'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_SET_PID,
      "tooltip": "Default PID:\n" + 
                 "MoveSync: MID(0.002, 0.00, 0.004) TT(0.02, 0.00, 0.04)\n" + 
                 "MoveGyro: MID(0.52, 0.00, 0.15) TT(6.01, 0.00, 2.15)\n" +
                 "TurnGyro: MID(22.75, 0.02, 1.54) TT(22.75, 0.08, 0.25)",
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PID_TYPE",
          "options": [
            ["MoveSyncPID", "MoveSyncPID"],
            ["MoveGyroPID", "MoveGyroPID"],
            ["TurnGyroPID", "TurnGyroPID"]
          ]
        },
        {
          "type": "input_value",
          "name": "KP",
        },
        {
          "type": "input_value",
          "name": "KI",
        },
        {
          "type": "input_value",
          "name": "KD",
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

//----- PPR Control (In DC category)
// MiniR4.M2.setPPR_RPM(ppr, rpm);
Blockly.Blocks['mini_ddc_set_ppr_rpm'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_SET_PPR_RPM,
      "tooltip": "Default PPR and Max RPM:\n" + 
                 "MID(360PPR, 300RPM) TT(545PPR, 200RPM)",
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/motor.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": profile.default.pwm,
        },
        {
          "type": "input_value",
          "name": "PPR",
        },
        {
          "type": "input_value",
          "name": "RPM",
        }
      ],
      "category": Blockly.Categories._mini,
      "extensions": ["colours__mini", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.DriveDC.MoveDegs(left, right, degrees, brake);
// MiniR4.DriveDC.MoveTime(left, right, time, brake);
Blockly.Blocks['mini_ddc_runFor'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_RUNFOR,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "NUM",
        },
        {
          "type": "field_dropdown",
          "name": "UNIT",
          "options": [
            [AG("DEGREES"), "degrees"],
            [AG("SECONDS"), "seconds"]
          ],
        },
        {
          "type": "input_value",
          "name": "SPEEDL",
        },
        {
          "type": "input_value",
          "name": "SPEEDR",
        },
        {
          "type": "field_dropdown",
          "name": "BrakeType",
          "options": [
            [AG("BRAKE"), "true"],
            [AG("COAST"), "false"]
          ]
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.DriveDC.MoveSyncDegs(left, right, degrees, brake);
// MiniR4.DriveDC.MoveSyncTime(left, right, time, brake);
Blockly.Blocks['mini_ddc_runFor_sync'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_RUNFOR_SYNC,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "NUM",
        },
        {
          "type": "field_dropdown",
          "name": "UNIT",
          "options": [
            [AG("DEGREES"), "degrees"],
            [AG("SECONDS"), "seconds"]
          ],
        },
        {
          "type": "input_value",
          "name": "SPEEDL",
        },
        {
          "type": "input_value",
          "name": "SPEEDR",
        },
        {
          "type": "field_dropdown",
          "name": "BrakeType",
          "options": [
            [AG("BRAKE"), "true"],
            [AG("COAST"), "false"]
          ]
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.DriveDC.MoveGyroDegs(speed, heading, degrees, brake);
// MiniR4.DriveDC.MoveGyroTime(speed, heading, time, brake);
Blockly.Blocks['mini_ddc_runFor_gyro'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_RUNFOR_GYRO,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "NUM",
        },
        {
          "type": "field_dropdown",
          "name": "UNIT",
          "options": [
            [AG("DEGREES"), "degrees"],
            [AG("SECONDS"), "seconds"]
          ],
        },
        {
          "type": "input_value",
          "name": "SPEED",
        },
        {
          "type": "field_dropdown",
          "name": "BrakeType",
          "options": [
            [AG("BRAKE"), "true"],
            [AG("COAST"), "false"]
          ]
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.DriveDC.Move(left, right);
Blockly.Blocks['mini_ddc_on'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_ON,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "SPEEDL",
        },
        {
          "type": "input_value",
          "name": "SPEEDR",
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.DriveDC.MoveSync(left, right);
Blockly.Blocks['mini_ddc_on_sync'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_ON_SYNC,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "SPEEDL",
        },
        {
          "type": "input_value",
          "name": "SPEEDR",
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.DriveDC.MoveGyro(speed, heading);
Blockly.Blocks['mini_ddc_on_gyro'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_ON_GYRO,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "SPEEDL",
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.DriveDC.TurnGyro(speed, angle, mode, brake);
Blockly.Blocks['mini_ddc_turn'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_TURN,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "ANGLE",
        },
        {
          "type": "input_value",
          "name": "SPEED",
        },
        {
          "type": "field_dropdown",
          "name": "BrakeType",
          "options": [
            [AG("BRAKE"), "true"],
            [AG("COAST"), "false"]
          ]
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

// MiniR4.DriveDC.TurnGyro(speed, angle, mode, brake);
Blockly.Blocks['mini_ddc_turntwo'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_TURNTWO,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "input_value",
          "name": "ANGLE",
        },
        {
          "type": "input_value",
          "name": "SPEED",
        },
        {
          "type": "field_dropdown",
          "name": "BrakeType",
          "options": [
            [AG("BRAKE"), "true"],
            [AG("COAST"), "false"]
          ]
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.DriveDC.resetCounter();
Blockly.Blocks['mini_ddc_reset_degs'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_RESET_DEGS,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};

//MiniR4.DriveDC.getDegrees();
Blockly.Blocks['mini_ddc_get_degs'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_GET_DEGS,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "output_number", "scratch_extension"]
    });
  }
};

//Off(OUT_BC);
Blockly.Blocks['mini_ddc_off'] = {
  init: function () {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_DDC_OFF,
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/movement.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "BrakeType",
          "options": [
            [AG("BRAKE"), "true"],
            [AG("COAST"), "false"]
          ]
        }
      ],
      "category": Blockly.Categories.movement,
      "extensions": ["colours_movement", "shape_statement", "scratch_extension"]
    });
  }
};


//////// Line Tracker /////////

// 初始化
Blockly.Blocks['mini_i2c_mxlinetracer_begin'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLINETRACER_BEGIN || 'MX Line Tracer initialize %1',
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_line.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [['I2C0(A3)', 'I2C0']]
        }
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

// 讀取單一感應器（獨立）
Blockly.Blocks['mini_i2c_mxlinetracer_getsensor'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLINETRACER_GETSENSOR || 'MX Line Tracer %1 sensor %2',
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_line.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [['I2C0(A3)', 'I2C0']]
        },
        {
          "type": "input_value",
          "name": "SENSOR"
        }
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

// 數值類型方塊（整合：getLineWidth, getLastSensor, getJunctionType, getError）
Blockly.Blocks['mini_i2c_mxlinetracer_get_number'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLINETRACER_GET_NUMBER || 'MX Line Tracer %1 get %2',
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_line.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [['I2C0(A3)', 'I2C0']]
        },
        {
          "type": "field_dropdown",
          "name": "TYPE",
          "options": [
            [Blockly.Msg.MINI_I2C_MXLINETRACER_OPTION_LINEWIDTH || 'line width', 'LINEWIDTH'],
            [Blockly.Msg.MINI_I2C_MXLINETRACER_OPTION_LASTSENSOR || 'last sensor', 'LASTSENSOR'],
            [Blockly.Msg.MINI_I2C_MXLINETRACER_OPTION_JUNCTIONTYPE || 'junction type', 'JUNCTIONTYPE'],
            [Blockly.Msg.MINI_I2C_MXLINETRACER_OPTION_ERROR || 'error', 'ERROR']
          ]
        }
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "output_number", "scratch_extension"]
    });
  }
};

// 字串類型方塊（版本）
Blockly.Blocks['mini_i2c_mxlinetracer_get_string'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLINETRACER_GET_STRING || 'MX Line Tracer %1 get %2',
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_line.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [['I2C0(A3)', 'I2C0']]
        },
        {
          "type": "field_dropdown",
          "name": "TYPE",
          "options": [
            [Blockly.Msg.MINI_I2C_MXLINETRACER_OPTION_VERSION || 'version', 'VERSION']
          ]
        }
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "output_string", "scratch_extension"]
    });
  }
};

// 布林類型方塊（is online）
Blockly.Blocks['mini_i2c_mxlinetracer_get_boolean'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLINETRACER_GET_BOOLEAN || 'MX Line Tracer %1 %2',
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_line.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [['I2C0(A3)', 'I2C0']]
        },
        {
          "type": "field_dropdown",
          "name": "TYPE",
          "options": [
            [Blockly.Msg.MINI_I2C_MXLINETRACER_OPTION_ISONLINE || 'is online?', 'ISONLINE']
          ]
        }
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "output_boolean", "scratch_extension"]
    });
  }
};

// 設定閾值
Blockly.Blocks['mini_i2c_mxlinetracer_setthreshold'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLINETRACER_SETTHRESHOLD || 'MX Line Tracer %1 set threshold %2',
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_line.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [['I2C0(A3)', 'I2C0']]
        },
        {
          "type": "input_value",
          "name": "THRESHOLD"
        }
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

// 列印完整狀態
Blockly.Blocks['mini_i2c_mxlinetracer_printfullstatus'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLINETRACER_PRINTFULLSTATUS || 'MX Line Tracer %1 print full status',
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_line.svg",
          "width": 32,
          "height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [['I2C0(A3)', 'I2C0']]
        }
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

// 設定權重（對稱版 - 5個輸入自動對稱）
Blockly.Blocks['mini_i2c_mxlinetracer_setweights'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLINETRACER_SETWEIGHTS || 'MX Line Tracer %1 set weights (symmetric) S6:%2 S7:%3 S8:%4 S9:%5 S10:%6',
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_line.svg",
          "width": 32,
					"height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [['I2C0(A3)', 'I2C0']]
        },
        {"type": "input_value", "name": "W6"},
        {"type": "input_value", "name": "W7"},
        {"type": "input_value", "name": "W8"},
        {"type": "input_value", "name": "W9"},
        {"type": "input_value", "name": "W10"}
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

// 校準控制
Blockly.Blocks['mini_i2c_mxlinetracer_calibration'] = {
  init: function() {
    this.jsonInit({
      "message0": '%1 %2',
      "message1": Blockly.Msg.MINI_I2C_MXLINETRACER_CALIBRATION || 'MX Line Tracer %1 calibration %2',
      "args0": [
        {
          "type": "field_image",
          "src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/sensor_line.svg",
          "width": 32,
					"height": 32,
          "flip_rtl": true
        },
        {
          "type": "field_vertical_separator",
        }
      ],
      "args1": [
        {
          "type": "field_dropdown",
          "name": "PIN",
          "options": [['I2C0(A3)', 'I2C0']]
        },
        {
          "type": "field_dropdown",
          "name": "ACTION",
          "options": [
            [Blockly.Msg.MINI_I2C_MXLINETRACER_CALIBRATION_START || 'start', 'START'],
            [Blockly.Msg.MINI_I2C_MXLINETRACER_CALIBRATION_END || 'end', 'END']
          ]
        }
      ],
      "category": Blockly.Categories._mini_thrdpty,
      "extensions": ["colours__mini_sensors", "shape_statement", "scratch_extension"]
    });
  }
};

// ====================
// WiFi Block Definitions
// ====================

// WiFi 連線
Blockly.Blocks['mini_wifi_connect'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/wifi.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_WIFI_CONNECT,
			"args1": [
				{
					"type": "input_value",
					"name": "SSID",
					"check": "String"
				},
				{
					"type": "input_value",
					"name": "PASSWORD",
					"check": "String"
				}
			],
			"category": "WiFi",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#00B8D4"
		});
	}
};

// WiFi 連線狀態
Blockly.Blocks['mini_wifi_status'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/wifi.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_WIFI_STATUS,
			"args1": [],
			"category": "WiFi",
			"extensions": ["colours__mini_iot", "output_boolean", "scratch_extension"],
			"colour": "#00B8D4"
		});
	}
};

// WiFi 取得 IP
Blockly.Blocks['mini_wifi_localip'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/wifi.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_WIFI_LOCALIP,
			"args1": [],
			"category": "WiFi",
			"extensions": ["colours__mini_iot", "output_string", "scratch_extension"],
			"colour": "#00B8D4"
		});
	}
};

// WiFi 設定固定 IP
Blockly.Blocks['mini_wifi_config'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/wifi.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_WIFI_CONFIG,
			"args1": [
				{
					"type": "input_value",
					"name": "IP1",
					"check": "Number"
				},
				{
					"type": "input_value",
					"name": "IP2",
					"check": "Number"
				},
				{
					"type": "input_value",
					"name": "IP3",
					"check": "Number"
				},
				{
					"type": "input_value",
					"name": "IP4",
					"check": "Number"
				}
			],
			"category": "WiFi",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#00B8D4"
		});
	}
};

// WiFi 啟動 AP 模式
Blockly.Blocks['mini_wifi_create_ap'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/wifi.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_WIFI_CREATE_AP,
			"args1": [
				{
					"type": "input_value",
					"name": "SSID",
					"check": "String"
				},
				{
					"type": "input_value",
					"name": "PASSWORD",
					"check": "String"
				}
			],
			"category": "WiFi",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#00B8D4"
		});
	}
};

// ====================
// MQTT Block Definitions
// ====================

// MQTT 連線設定
Blockly.Blocks['mini_mqtt_connect'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mqtt.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_MQTT_CONNECT,
			"args1": [
				{
					"type": "input_value",
					"name": "BROKER",
					"check": "String"
				},
				{
					"type": "input_value",
					"name": "PORT",
					"check": "Number"
				},
				{
					"type": "input_value",
					"name": "CLIENTID",
					"check": "String"
				},
				{
					"type": "input_value",
					"name": "USERNAME",
					"check": "String"
				},
				{
					"type": "input_value",
					"name": "PASSWORD",
					"check": "String"
				}
			],
			"category": "MQTT",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#0097A7"
		});
	}
};

// MQTT Loop
Blockly.Blocks['mini_mqtt_loop'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mqtt.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_MQTT_LOOP,
			"args1": [],
			"category": "MQTT",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#0097A7"
		});
	}
};

// MQTT 訂閱主題
Blockly.Blocks['mini_mqtt_subscribe'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mqtt.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_MQTT_SUBSCRIBE,
			"args1": [
				{
					"type": "input_value",
					"name": "TOPIC",
					"check": "String"
				},
				{
					"type": "field_dropdown",
					"name": "QOS",
					"options": [
						["0", "0"],
						["1", "1"],
						["2", "2"]
					]
				}
			],
			"category": "MQTT",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#0097A7"
		});
	}
};

// MQTT 發布訊息
Blockly.Blocks['mini_mqtt_publish'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mqtt.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_MQTT_PUBLISH,
			"args1": [
				{
					"type": "input_value",
					"name": "TOPIC",
					"check": "String"
				},
				{
					"type": "input_value",
					"name": "MESSAGE"
				}
			],
			"category": "MQTT",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#0097A7"
		});
	}
};

// MQTT 當收到訊息時 (Event Hat)
Blockly.Blocks['mini_mqtt_on_message'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mqtt.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_MQTT_ON_MESSAGE,
			"args1": [],
			"message2": "%1",
			"args2": [
				{
					"type": "input_statement",
					"name": "SUBSTACK"
				}
			],
			"category": "MQTT",
			"extensions": ["colours__mini_iot"],
			"colour": "#0097A7"
		});
	}
};

// MQTT 接收到的主題
Blockly.Blocks['mini_mqtt_received_topic'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mqtt.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_MQTT_RECEIVED_TOPIC,
			"args1": [],
			"category": "MQTT",
			"extensions": ["colours__mini_iot", "output_string", "scratch_extension"],
			"colour": "#0097A7"
		});
	}
};

// MQTT 接收到的訊息
Blockly.Blocks['mini_mqtt_received_message'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mqtt.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_MQTT_RECEIVED_MESSAGE,
			"args1": [],
			"category": "MQTT",
			"extensions": ["colours__mini_iot", "output_string", "scratch_extension"],
			"colour": "#0097A7"
		});
	}
};

// MQTT 連線狀態
Blockly.Blocks['mini_mqtt_is_connected'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/mqtt.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_MQTT_IS_CONNECTED,
			"args1": [],
			"category": "MQTT",
			"extensions": ["colours__mini_iot", "output_boolean", "scratch_extension"],
			"colour": "#0097A7"
		});
	}
};

// ====================
// BLE Block Definitions
// ====================

// BLE 初始化
Blockly.Blocks['mini_ble_begin'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/ble.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_BLE_BEGIN,
			"args1": [],
			"category": "BLE",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#5C6BC0"
		});
	}
};

// BLE 設定裝置名稱
Blockly.Blocks['mini_ble_set_name'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/ble.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_BLE_SET_NAME,
			"args1": [
				{
					"type": "input_value",
					"name": "NAME",
					"check": "String"
				}
			],
			"category": "BLE",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#5C6BC0"
		});
	}
};

// BLE 資料更新
Blockly.Blocks['mini_ble_poll'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/ble.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_BLE_POLL,
			"args1": [],
			"category": "BLE",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#5C6BC0"
		});
	}
};

// BLE 連線狀態
Blockly.Blocks['mini_ble_connected'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/ble.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_BLE_CONNECTED,
			"args1": [],
			"category": "BLE",
			"extensions": ["colours__mini_iot", "output_boolean", "scratch_extension"],
			"colour": "#5C6BC0"
		});
	}
};

// BLE 啟用 Nordic UART Service
Blockly.Blocks['mini_ble_uart_enable'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/ble.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_BLE_UART_ENABLE,
			"args1": [],
			"category": "BLE",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#5C6BC0"
		});
	}
};

// BLE Nordic UART 發送
Blockly.Blocks['mini_ble_uart_send'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/ble.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_BLE_UART_SEND,
			"args1": [
				{
					"type": "input_value",
					"name": "MESSAGE"
				}
			],
			"category": "BLE",
			"extensions": ["colours__mini_iot", "shape_statement", "scratch_extension"],
			"colour": "#5C6BC0"
		});
	}
};

// BLE 當收到資料時 (Event Hat)
Blockly.Blocks['mini_ble_on_received'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/ble.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_BLE_ON_RECEIVED,
			"args1": [],
			"message2": "%1",
			"args2": [
				{
					"type": "input_statement",
					"name": "SUBSTACK"
				}
			],
			"category": "BLE",
			"extensions": ["colours__mini_iot", "shape_hat", "scratch_extension"],
			"colour": "#5C6BC0"
		});
	}
};

// BLE 接收到的資料
Blockly.Blocks['mini_ble_received_data'] = {
	init: function () {
		this.jsonInit({
			"message0": "%1 %2",
			"args0": [
				{
					"type": "field_image",
					"src": Blockly.mainWorkspace.options.pathToMedia + "mini-icons/ble.svg",
					"width": 32,
					"height": 32
				},
        {
          "type": "field_vertical_separator",
        }
			],
			"message1": Blockly.Msg.MINI_BLE_RECEIVED_DATA,
			"args1": [],
			"category": "BLE",
			"extensions": ["colours__mini_iot", "output_string", "scratch_extension"],
			"colour": "#5C6BC0"
		});
	}
};