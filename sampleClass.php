<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
include_once("header.php");

class Club {
	protected static $tablename = "club";
	protected static $attributes = array('id', 'name', 'address', 'city', 'state', 'zip', 'password');

	public $id;
	public $name;
	public $address;
	public $city;
	public $state;
	public $zip;
	public $password;

// load into database and/or update

// 1: retrieve the database attributes

	public function getDbAttributes(){
		$dbAttributes = array();
		for(static::$attributes as $attribute){
			if(property_exists($this, $attribute)){
				$dbAttributes[$attribute] = $this->$attribute;
			}
		}
		return $dbAttributes;
	}

// 2: Sanitize said attributes

	public function getSanitizedAttributes(){
		$sanitizedAttributes = array();

		$dbAttributes = $this->getDbAttributes();

		foreach($dbAttributes as $dbAttribute => $value){
			$sanitizedAttributes[$dbAttribute] = mysql_real_escape_string($value);
		}

		return $sanitizedAttributes;
	}

// 3: Create the new database instance
	public function create(){
		global $db;

		$clubAttributes = $this->getSanitizedAttributes();

		$sql = "INSERT INTO " . static::$tablename . "(" . join(", ", array_keys($clubAttributes)) . ") VALUES ('" . join("', '", array_values($clubAttributes)) . "')";

		if($db->query($sql)){
			$this->id = $this->get_inserted_id();
			return true;
		} else {
			return false; 
		}
	}

	public function update(){
		global $db;

		$pairedAttributes = array();

		$databaseAttributes = $this->getSanitizedAttributes();
		
		foreach ($databaseAttributes as $databaseAttribute => $value){
			$pairedAttributes[] = "$databaseAttribute = '$value'";
		}

		$sql = "UPDATE " . static::$tablename .
			   " SET " . join(", ", $pairedAttributes) . " " . "WHERE id = '$this->id'"  ;


		if($db->query($sql)){
			return true;
		} else {
			return false;
		}
	}

	public function save(){
		if((isset($this->id)) && !empty($this->id)){
			$result = $this->update();
			return $result;
		} else {
			$result = $this->create();
			return $result;
		}
	}

// Instantiation:

	// 0: Need to be able to see if the attributes exist

	public function has_attribute($attribute){
		$clubAttributes = get_object_vars($this);
		return array_key_exists($attribute, $clubAttributes);
	}

	// 1: pull row data from a database, confirm the NEEDED attributes and create an object instance.

	public static function instantiate($row){
		global $db;
		$object = new static;

		foreach($row as $attribute => $value){
			if($object->hasAttribute($attribute)){
				$object->$attribute = $value;
			}
		}

		return $object;
	}

	public static function find_by_id($id){
		global $db;

        $sql = "SELECT * FROM " . static::$tablename . " WHERE id = '" . $id . "' LIMIT 1";
        $resultSet = $db->query($sql);

        while($row = mysql_fetch_assoc($resultSet)){
            $object = static::instantiate($row);
        }

        return $object;    

	}

}