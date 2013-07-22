<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");

class Club extends DatabaseObject{
	protected static $tablename = "club";
	protected static $attributes = array('id', 'name', 'address', 'city', 'state', 'zip', 'password');

	public $id;
	public $name;
	public $address;
	public $city;
	public $state;
	public $zip;
	public $password;
	
	public static function newClub($name, $address, $city, $state, $zip, $password){
		$Object = new static;

		$Object->name = $name;
		$Object->address = $address;
		$Object->city = $city;
		$Object->state = $state;
		$Object->zip = $zip;
		$Object->password = $password;
		return $Object;
	}
}