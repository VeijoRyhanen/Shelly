/**
 * File dew.js
 * Copyright 2003 Wolfgang Kuehn https://www.decatur.de/javascript/dew/dew-js.html
 * Shelly ADD-ON + HT22 support: Veijo Ryhänen, 2024
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *       http://www.apache.org/licenses/LICENSE-2.0
 */
var verbose = false;
var logToKVS = true;
var KVS_prefix = "dew_point_switch";
// Define timespan: minutes * 60 sec * 1000 milliseconds
let interval = 1 * 60 * 1000;
var version = 20240120;
var sensorId = 100; //,101 or 102
var dewPointAndTempDiff = 3;
var hysteresis = 2;
var tempC = 0;
var humidity = 0;
var dpC = 0;

var KELVIN = 0;
var CELSIUS = 1;
var FAHRENHEIT = 2;

var C_OFFSET = 273.15;
var F_C = 9.0/5.0;

var RELATIVE = 1;
var ABSOLUTE = 2;

function Temperatures() {
  this.array = new Array();
}

Temperatures.prototype.add = function(t) {
  if (t.value!=null)
    this.array[this.array.length] = t;
}

var temps = new Temperatures();

Temperatures.prototype.syncronize = function() {
  for (var e in this.array) {
    var t = this.array[e];
    if (t.value!=null)
      t.onChange();
  }
}

Temperatures.prototype.setScale = function(scale) {
  for (var e in this.array)
    this.array[e].setScale(scale);
}

function Temperature(value, scale, elem) {
  this.value;
  this.scale = scale;
  this.element = elem;
  this.set(value);
  temps.add(this);
}

Temperature.prototype.onChange = function() {
  var v = stringToFloat(this.element.value);
  this.set(v);
}

Temperature.prototype.update = function() {
  if (this.element!=null)
    this.element.value = truncate(this.get(),2,ABSOLUTE);
}

Temperature.prototype.setScale = function(scale) {
  this.scale = scale;
  this.update(); 
}

Temperature.prototype.getScale = function() {
  return this.scale;
}

Temperature.prototype.getKelvin = function() {
  return this.value;
}

Temperature.prototype.setKelvin = function(value) {
  this.value = value;
  this.update();
}

Temperature.prototype.get = function() {
  var v = this.value;
  if (this.scale==CELSIUS)
    v -= C_OFFSET;
  else if (this.scale==FAHRENHEIT)
    v = 32+(v-C_OFFSET)*F_C;
  return v;
}

Temperature.prototype.set = function(value) {
  this.value = value;
  if (this.scale==CELSIUS)
    this.value += C_OFFSET;
  else if (this.scale==FAHRENHEIT)
    this.value = (this.value-32)/F_C+C_OFFSET;
  this.update();
}

Temperature.prototype.setElement = function(element) {
  this.element = element;
  this.update();
}

function TemperatureChange(value, scale, element) {
  this.scale = scale;
  this.element = element;
  this.set(value);
  temps.add(this);
}

TemperatureChange.prototype = new Temperature();

TemperatureChange.prototype.get = function() {
  var v = this.value;
  if (this.scale==FAHRENHEIT)
    v = v*F_C;
  return v;
}

TemperatureChange.prototype.set = function(value) {
  this.value = value;
  if (this.scale==FAHRENHEIT)
    this.value = this.value/F_C;
  this.update();
}


var minT = 173; // -100 Deg. C.
var maxT = 678;

/*
 * Saturation Vapor Pressure formula for range -100..0 Deg. C.
 * This is taken from
 *   ITS-90 Formulations for Vapor Pressure, Frostpoint Temperature,
 *   Dewpoint Temperature, and Enhancement Factors in the Range 100 to +100 C
 * by Bob Hardy
 * as published in "The Proceedings of the Third International Symposium on Humidity & Moisture",
 * Teddington, London, England, April 1998
*/
var k0 = -5.8666426e3;
var k1 = 2.232870244e1;
var k2 = 1.39387003e-2;
var k3 = -3.4262402e-5;
var k4 = 2.7040955e-8;
var k5 = 6.7063522e-1;

function pvsIce(T) {
  try{
    lnP = k0/T + k1 + (k2 + (k3 + (k4*T))*T)*T + k5*Math.log(T);
  }catch(err2){
    print("err2="+err2);
    return -999;
  }
  return Math.exp(lnP);
}

/**
 * Saturation Vapor Pressure formula for range 273..678 Deg. K.
 * This is taken from the
 *   Release on the IAPWS Industrial Formulation 1997
 *   for the Thermodynamic Properties of Water and Steam
 * by IAPWS (International Association for the Properties of Water and Steam),
 * Erlangen, Germany, September 1997.
 *
 * This is Equation (30) in Section 8.1 "The Saturation-Pressure Equation (Basic Equation)"
*/

var n1 = 0.11670521452767e4;
var n6 = 0.14915108613530e2;
var n2 = -0.72421316703206e6;
var n7 = -0.48232657361591e4;
var n3 = -0.17073846940092e2;
var n8 = 0.40511340542057e6;
var n4 = 0.12020824702470e5;
var n9 = -0.23855557567849;
var n5 = -0.32325550322333e7;
var n10 = 0.65017534844798e3;

function pvsWater(T) {
  var th = T+n9/(T-n10);
  var A = (th+n1)*th+n2;
  var B = (n3*th+n4)*th+n5;
  var C = (n6*th+n7)*th+n8;

  var p = 2*C/(-B+Math.sqrt(B*B-4*A*C));
  p *= p;
  p *= p;
  return p*1e6;
}

/**
 * Compute Saturation Vapor Pressure for minT<T[Deg.K]<maxT.
 */
function PVS(T) {
  if (T<minT || T>maxT) return NaN;
  else if (T<C_OFFSET)
    return pvsIce(T);
  else
    return pvsWater(T);
}

/**
 * Compute dewPoint for given relative humidity RH[%] and temperature T[Deg.K].
 */
function dewPoint(RH,T) {
  return solve(PVS, RH/100*PVS(T), T);
}

/**
 * Newton's Method to solve f(x)=y for x with an initial guess of x0.
 */
function solve(f,y,x0) {
  var x = x0;
  var maxCount = 10;
  var count = 0;
  do {
    var xNew;
    var dx = x/1000; 
    var z=f(x);
    xNew = x + dx*(y-z)/(f(x+dx)-z);
    if (Math.abs((xNew-x)/xNew)<0.0001) 
      return xNew;
    else if (count>maxCount) {
      xnew=NaN; 
      //throw new Error(1, "Solver does not converge.");
      print("Solver does not converge.");
      return "--";
      break; 
    }
    x = xNew;
    count ++;
  } while (true);
}

function truncate(x, precision, mode) {
  if (x==0)
    return 0;
  var magnitude;
  if (mode==RELATIVE)
    magnitude = Math.round(Math.log(Math.abs(x))/Math.LN10);
  else
    magnitude = 0;
  var scale = Math.pow(10,precision-magnitude);
  return Math.round(x*scale)/scale;
}

function stringToFloat(s) {
  if (s.search(/^\s*(\+|\-)?\d*(\.\d*)?\s*$/)==-1)
    throw new Error("'"+s+"' is not a valid number", "'"+s+"' is not a valid number");
  return parseFloat(s);
}

function convert () {
  var scale;
  if (document.FORM.TScale[1].checked)
    scale = 1;
  else if (document.FORM.TScale[2].checked)
    scale = 2;
  else
    scale = 0;

  this.temps.setScale(scale);
}

function KVS_print(KVS_suffix)
{
    let hour = new Date().getHours();
    let minutes = new Date().getMinutes();
    let fullKey=KVS_prefix+KVS_suffix;
    if(logToKVS){
      fullValue=hour+":"+minutes;
    }//else{
      // Lisätään aikaleima avaimeen, eli ei ylikirjoiteta edellistä KVS varastoon lokitettua riviä:
      //fullKey=fullKey+"_"+hour+":"+minutes;
    //}
    Shelly.call(
       "KVS.Set",
        { key: fullKey  , value: fullValue },
        null);
}

function printv(message)
{
  if( verbose ){
    print(message);
  }
}

function printResults(){
  printv("temperature="+tempC);
  printv("humidity: "+humidity);
  humidity = Math.round(humidity,0);
  tempC = Math.round(tempC,0);
  print("temperature: "+tempC);
  print("humidity: "+humidity);
  var dpK = dewPoint(humidity, 273+tempC);
  if( dpK == "--" ){
    dpC = "--";
  }else{
    dpC = (dpK-273).toFixed(2);
  }
  print("Dew point is ",dpC+" Celsius");
}

function toggleSwitch(){
  if((tempC-dpC)<dewPointAndTempDiff){
    Shelly.call("Switch.set","{id:0,on:true}",null,null);
    KVS_print("_ON");
  }else if ((tempC-dpC)>(dewPointAndTempDiff+hysteresis)){
    Shelly.call("Switch.set","{id:0,on:false}",null,null);
    KVS_print("_OFF");
 }
}
function measureCalculatePrint()
{
  Shelly.call(
    "temperature.getStatus",
    { id: sensorId },
    function (response) {  
        printv("temperature: response="+JSON.stringify(response));
        if (response != null ){
           tempC=response.tC;
        }else{
           printv("Temperature sensor "+sensorId +" not found!");
        }
    },
    null
  );
  
  Shelly.call(
    "humidity.getStatus",
    { id: sensorId},
    function (responseH) {  
        printv("humidity: response="+JSON.stringify(responseH));
        if (responseH != null ){
          humidity=responseH.rh;
          printResults();
          toggleSwitch();
        }else{
          print("Humidity sensor "+sensorId +" not found!");
        }
    },
    null
  );
}

function endlessLoop()
{
  // Set timer which send the HTTP POST
  Timer.set(
    interval,
    true,
    function () { 
      measureCalculatePrint(); 
      //Shelly.call("HTTP.POST", {"url": tsjsonurl, "body": tsjson, "timeout": 5});
    }
  );
}
measureCalculatePrint();
if(verbose){
  print("Waiting for "+interval/1000+"s. between measurements.");
}
endlessLoop();
