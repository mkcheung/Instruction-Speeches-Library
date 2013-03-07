<?php
require_once("DatabaseObject.php");

class User extends DatabaseObject{
	protected static $tablename = 'users';
	protected static $attributes = array('id','first_name','last_name','username','hashed_password', 'email');

	public $id;
	public $first_name;
	public $last_name;
	public $username;
	public $hashed_password;
	public $email;

	public function fullname(){
		return ($first_name . ' ' .$last_name);
	}

	public static function authenticate($username, $password){

		global $db;

		$sql = "SELECT *"
		       . " FROM users"
		       . " WHERE username = '" . $username
		       . "' AND hashed_password = '" . $password 
		       . "' LIMIT 1";

		$result = $db->query($sql);
		if($db->numAffectedRows() == 1){
			$userRecord = mysql_fetch_assoc($result);
			return static::instantiate($userRecord);
		} else{
			return false;
		}
	}

	public static function register($username, $password, $firstname, $lastname, $email){
		global $db;

		$Object = new static;

		$Object->username = $username;
		$Object->first_name = $firstname;
		$Object->last_name = $lastname;
		$Object->hashed_password = $password;
		$Object->email = $email;
		return $Object;
	}

}
?>